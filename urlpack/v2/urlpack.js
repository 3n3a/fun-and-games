/**
 * urlpack — pack any text (URLs, JSON, whole documents) into a compact,
 * URL-fragment-safe string, and unpack it losslessly.
 *
 *   import { pack, unpack, ready } from './urlpack.js';
 *   const s = await pack('https://例え.jp/path?q=ü&x=1');   // -> "Nl9c..." (no % escapes)
 *   const original = await unpack(s);
 *
 * Pipeline:  text -> UTF-8 -> URL dictionary -> Brotli(q11) -> header byte -> base85
 *
 * Brotli at quality 11 is the strongest general-purpose lossless codec available
 * in a browser, and its built-in 120 KB static dictionary is full of web text
 * ("https://", ".com/", "index.html", common English/HTML fragments), which is
 * exactly what makes it beat gzip/deflate badly on short URLs.
 *
 * Every candidate encoding is tried and the smallest wins, so the output is
 * never larger than raw + 1 byte.
 */

import { substitute, restore, DICT_VERSION } from './urldict.js';

/* ------------------------------------------------------------------ *
 * 1. Alphabet
 * ------------------------------------------------------------------ */

/**
 * 85 characters that survive a URL fragment without percent-encoding.
 *
 * RFC 3986 allows exactly 81 unescaped characters after the "#":
 *   unreserved  A-Z a-z 0-9 - . _ ~
 *   sub-delims  ! $ & ' ( ) * + , ; =
 *   plus        : @ / ?
 * That is four short of 85, so the last four are [ ] { } — not in the grammar,
 * but in the WHATWG URL spec's fragment percent-encode set only C0 controls,
 * space, " , < , > and ` are escaped, so every browser round-trips these
 * verbatim through location.hash.
 *
 * If you need strict RFC compliance, use BASE64URL below instead: 6 bits per
 * character instead of 6.41, i.e. ~6.5% longer output, zero risk.
 */
export const BASE85 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~!$&'()*+,;=:@/?[]{}";

export const BASE64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/* ------------------------------------------------------------------ *
 * 2. base85 (Ascii85 packing, custom alphabet)
 * ------------------------------------------------------------------ */

const tableCache = new Map();

function tableFor(alphabet) {
  let t = tableCache.get(alphabet);
  if (t) return t;
  if (alphabet.length !== 85) throw new Error('alphabet must be 85 characters');
  t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 85; i++) {
    const c = alphabet.charCodeAt(i);
    if (c > 127) throw new Error('alphabet must be ASCII');
    if (t[c] !== -1) throw new Error('duplicate character in alphabet: ' + alphabet[i]);
    t[c] = i;
  }
  tableCache.set(alphabet, t);
  return t;
}

/** Uint8Array -> base85 string. 4 bytes become 5 characters (1.25x). */
export function base85Encode(bytes, alphabet = BASE85) {
  tableFor(alphabet);
  const n = bytes.length;
  const full = n - (n % 4);
  const out = [];
  for (let i = 0; i < full; i += 4) {
    out.push(digits5(
      bytes[i] * 16777216 + bytes[i + 1] * 65536 + bytes[i + 2] * 256 + bytes[i + 3],
      alphabet,
    ));
  }
  const rem = n - full;
  if (rem) {
    let v = 0;
    for (let j = 0; j < 4; j++) v = v * 256 + (j < rem ? bytes[full + j] : 0);
    out.push(digits5(v, alphabet).slice(0, rem + 1)); // r bytes -> r+1 chars
  }
  return out.join('');
}

function digits5(v, alphabet) {
  let s = '';
  for (let k = 0; k < 5; k++) {
    s = alphabet[v % 85] + s;
    v = Math.floor(v / 85);
  }
  return s;
}

/** base85 string -> Uint8Array. */
export function base85Decode(str, alphabet = BASE85) {
  const table = tableFor(alphabet);
  const n = str.length;
  const rem = n % 5;
  if (rem === 1) throw new Error('invalid base85 length');
  const full = n - rem;
  const out = new Uint8Array((full / 5) * 4 + (rem ? rem - 1 : 0));
  let p = 0;
  for (let i = 0; i < full; i += 5) p = block(str, i, 5, 4, table, out, p);
  if (rem) p = block(str, full, rem, rem - 1, table, out, p);
  return out;
}

function block(str, off, count, write, table, out, p) {
  let v = 0;
  for (let k = 0; k < 5; k++) {
    // Partial tails are padded with the highest digit so truncation rounds correctly.
    let d = 84;
    if (k < count) {
      const c = str.charCodeAt(off + k);
      d = c < 128 ? table[c] : -1;
      if (d < 0) throw new Error('invalid base85 character: ' + JSON.stringify(str[off + k]));
    }
    v = v * 85 + d;
  }
  if (v > 4294967295) throw new Error('base85 block out of range');
  const b = [
    Math.floor(v / 16777216) & 255,
    Math.floor(v / 65536) & 255,
    Math.floor(v / 256) & 255,
    v & 255,
  ];
  for (let k = 0; k < write; k++) out[p++] = b[k];
  return p;
}

/* ------------------------------------------------------------------ *
 * 3. Compression back ends
 * ------------------------------------------------------------------ */

/**
 * Header byte: high nibble = dictionary version (0 = none), low nibble = codec.
 * Old links keep decoding because dictionary 0 is what they were written with.
 */
const FMT = { RAW: 0, BROTLI: 1, DEFLATE: 2 };
const CODEC_MASK = 0x0f;

/**
 * Where to load Brotli from.
 *
 * This points at the wasm-bindgen glue INSIDE the package, not at the package
 * root, and hands init() an explicit .wasm URL. Importing "brotli-wasm" bare
 * from an ESM CDN lets the CDN pick the export condition: if it resolves the
 * "browser" condition it serves pkg.bundler, whose glue does
 * `import * as wasm from './brotli_wasm_bg.wasm'` — a bundler-only construct
 * that no browser can execute. The import then rejects and the whole codec
 * silently disappears. Pinning the path removes the guesswork.
 *
 * Self-host both files in production; a CDN outage otherwise downgrades you
 * to deflate without warning.
 */
export const BROTLI = {
  js: 'https://cdn.jsdelivr.net/npm/brotli-wasm@3.0.1/pkg.web/brotli_wasm.js',
  wasm: 'https://cdn.jsdelivr.net/npm/brotli-wasm@3.0.1/pkg.web/brotli_wasm_bg.wasm',
};

let brotliPromise = null;
let brotliError = null;

/** Whatever stopped Brotli from loading, or null. */
export function loadError() { return brotliError; }

/** Load and initialise the wasm module. Safe to call repeatedly. */
export function ready(urls = BROTLI) {
  if (!brotliPromise) {
    brotliPromise = (async () => {
      const mod = await import(/* @vite-ignore */ urls.js);
      if (typeof mod.default === 'function') {
        await mod.default(urls.wasm);           // wasm-bindgen init, explicit binary
        if (typeof mod.compress !== 'function') throw new Error('no compress export');
        return mod;
      }
      const viaDefault = mod.default ? await mod.default : null;  // package-root shape
      if (viaDefault && typeof viaDefault.compress === 'function') return viaDefault;
      throw new Error('unrecognised brotli module shape');
    })().catch((err) => {
      brotliPromise = null;
      brotliError = err;
      console.warn('[urlpack] Brotli unavailable, falling back to deflate:', err);
      throw err;
    });
  }
  return brotliPromise;
}

async function brotliCompress(bytes, quality) {
  const brotli = await ready();
  // The only option this build accepts is `quality`. Anything else (lgwin,
  // lgblock, large_window) is accepted and silently ignored by the serde
  // deserialiser, so passing it just misleads you.
  return new Uint8Array(brotli.compress(bytes, { quality }));
}

async function brotliDecompress(bytes) {
  const brotli = await ready();
  return new Uint8Array(brotli.decompress(bytes));
}

async function streamThrough(bytes, stream) {
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  let total = 0;
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

const deflate = (b) => streamThrough(b, new CompressionStream('deflate-raw'));
const inflate = (b) => streamThrough(b, new DecompressionStream('deflate-raw'));

/* ------------------------------------------------------------------ *
 * 4. Public API
 * ------------------------------------------------------------------ */

/**
 * Compress text into a URL-fragment-safe string.
 *
 * @param {string} text      any Unicode text (URLs, JSON, prose, emoji, CJK…)
 * @param {object} [options]
 * @param {number} [options.quality=11]   Brotli quality, 0–11
 * @param {string} [options.alphabet]     defaults to BASE85
 * @param {boolean} [options.dictionary=true] try the URL phrase dictionary
 * @returns {Promise<string>}
 */
export async function pack(text, options = {}) {
  const { quality = 11, alphabet = BASE85, dictionary = true } = options;
  const raw = new TextEncoder().encode(text);

  // Two source variants: as typed, and with URL phrases tokenised. The
  // dictionary usually wins on short URLs and is a wash on long documents,
  // where Brotli finds the same redundancy on its own — so try both rather
  // than assume.
  const variants = [{ dict: 0, data: raw }];
  if (dictionary) {
    const sub = substitute(raw);
    if (sub.length < raw.length) variants.push({ dict: DICT_VERSION, data: sub });
  }

  let best = { dict: 0, fmt: FMT.RAW, data: raw };
  const consider = (dict, fmt, data) => {
    if (data && data.length < best.data.length) best = { dict, fmt, data };
  };

  const results = await Promise.all(variants.flatMap((v) => [
    brotliCompress(v.data, quality).then((d) => [v.dict, FMT.BROTLI, d], () => null),
    deflate(v.data).then((d) => [v.dict, FMT.DEFLATE, d], () => null),
  ]));

  for (const v of variants) consider(v.dict, FMT.RAW, v.data);
  for (const r of results) if (r) consider(r[0], r[1], r[2]);

  if (results.every((r) => r === null) && raw.length > 64) {
    throw new Error('no compressor available: ' + (brotliError?.message ?? 'unknown'));
  }

  const framed = new Uint8Array(best.data.length + 1);
  framed[0] = (best.dict << 4) | best.fmt;
  framed.set(best.data, 1);
  return base85Encode(framed, alphabet);
}

/**
 * Reverse of pack(). Throws on malformed input.
 * @param {string} packed
 * @param {object} [options]
 * @returns {Promise<string>}
 */
export async function unpack(packed, options = {}) {
  const { alphabet = BASE85 } = options;
  const framed = base85Decode(packed.trim().replace(/^#/, ''), alphabet);
  if (framed.length < 1) throw new Error('empty payload');
  const body = framed.subarray(1);
  let bytes;
  switch (framed[0] & CODEC_MASK) {
    case FMT.RAW: bytes = body; break;
    case FMT.BROTLI: bytes = await brotliDecompress(body); break;
    case FMT.DEFLATE: bytes = await inflate(body); break;
    default: throw new Error('unknown codec: ' + (framed[0] & CODEC_MASK));
  }
  const dict = framed[0] >> 4;
  if (dict === DICT_VERSION) bytes = restore(bytes);
  else if (dict !== 0) throw new Error('packed with dictionary v' + dict + ', this build has v' + DICT_VERSION);
  return new TextDecoder().decode(bytes);
}

/** pack() plus size accounting, for tuning and UI. */
export async function packWithStats(text, options) {
  const t0 = (globalThis.performance ?? Date).now();
  const packed = await pack(text, options);
  const inputBytes = new TextEncoder().encode(text).length;
  const codecs = ['stored', 'brotli', 'deflate'];
  const framed = base85Decode(packed, options?.alphabet ?? BASE85);
  return {
    packed,
    codec: codecs[framed[0] & 0x0f] ?? 'unknown',
    dictionary: (framed[0] >> 4) !== 0,
    inputBytes,
    payloadBytes: framed.length,
    outputChars: packed.length,
    ratio: inputBytes ? framed.length / inputBytes : 1,
    ms: (globalThis.performance ?? Date).now() - t0,
    brotliError: brotliError?.message ?? null,
  };
}

/** Write the packed text into location.hash. */
export async function writeHash(text, options) {
  const packed = await pack(text, options);
  location.hash = packed;
  return packed;
}

/** Read and unpack location.hash. Returns null when the hash is empty. */
export async function readHash(options) {
  const h = location.hash.slice(1);
  return h ? unpack(h, options) : null;
}

export const _internals = { FMT, deflate, inflate };
