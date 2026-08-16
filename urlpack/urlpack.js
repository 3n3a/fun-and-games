/**
 * urlpack — pack any text (URLs, JSON, whole documents) into a compact,
 * URL-fragment-safe string, and unpack it losslessly.
 *
 *   import { pack, unpack, ready } from './urlpack.js';
 *   const s = await pack('https://例え.jp/path?q=ü&x=1');   // -> "Nl9c..." (no % escapes)
 *   const original = await unpack(s);
 *
 * Pipeline:  text -> UTF-8 -> Brotli(q11, custom window) -> 1 header byte -> base85
 *
 * Brotli at quality 11 is the strongest general-purpose lossless codec available
 * in a browser, and its built-in 120 KB static dictionary is full of web text
 * ("https://", ".com/", "index.html", common English/HTML fragments), which is
 * exactly what makes it beat gzip/deflate badly on short URLs.
 *
 * Every candidate encoding is tried and the smallest wins, so the output is
 * never larger than raw + 1 byte.
 */

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

const FMT = { RAW: 0, BROTLI: 1, DEFLATE: 2 };

/**
 * Where to load Brotli from. Any ESM CDN that serves brotli-wasm works;
 * swap this for a self-hosted copy in production so the page has no third
 * party dependency at runtime.
 */
export const BROTLI_URL = 'https://esm.sh/brotli-wasm@3.0.1';

let brotliPromise = null;

/** Load and initialise the wasm module. Safe to call repeatedly. */
export function ready(url = BROTLI_URL) {
  if (!brotliPromise) {
    brotliPromise = (async () => {
      const mod = await import(/* @vite-ignore */ url);
      // brotli-wasm ships a few entry shapes depending on build target.
      const viaDefault = mod.default ? await mod.default : null;
      if (viaDefault && typeof viaDefault.compress === 'function') return viaDefault;
      if (typeof mod.compress === 'function') {
        if (typeof mod.default === 'function') await mod.default(); // wasm-bindgen init
        return mod;
      }
      throw new Error('unrecognised brotli module shape');
    })().catch((err) => {
      brotliPromise = null;
      throw err;
    });
  }
  return brotliPromise;
}

async function brotliCompress(bytes, quality, lgwin) {
  const brotli = await ready();
  return new Uint8Array(brotli.compress(bytes, { quality, lgwin }));
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
 * @param {number} [options.lgwin=24]     Brotli window, log2 bytes, 10–24
 * @param {string} [options.alphabet]     defaults to BASE85
 * @returns {Promise<string>}
 */
export async function pack(text, options = {}) {
  const { quality = 11, lgwin = 24, alphabet = BASE85 } = options;
  const raw = new TextEncoder().encode(text);

  let best = { fmt: FMT.RAW, data: raw };
  const consider = (fmt, data) => {
    if (data && data.length < best.data.length) best = { fmt, data };
  };

  const [br, df] = await Promise.all([
    brotliCompress(raw, quality, lgwin).catch(() => null),
    deflate(raw).catch(() => null),
  ]);
  consider(FMT.BROTLI, br);
  consider(FMT.DEFLATE, df);

  if (br === null && df === null && raw.length > 64) {
    throw new Error('no compressor available (failed to load ' + BROTLI_URL + ')');
  }

  const framed = new Uint8Array(best.data.length + 1);
  framed[0] = best.fmt;
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
  let raw;
  switch (framed[0]) {
    case FMT.RAW: raw = body; break;
    case FMT.BROTLI: raw = await brotliDecompress(body); break;
    case FMT.DEFLATE: raw = await inflate(body); break;
    default: throw new Error('unknown format byte: ' + framed[0]);
  }
  return new TextDecoder().decode(raw);
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
    codec: codecs[framed[0]] ?? 'unknown',
    inputBytes,
    payloadBytes: framed.length,
    outputChars: packed.length,
    ratio: inputBytes ? framed.length / inputBytes : 1,
    ms: (globalThis.performance ?? Date).now() - t0,
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
