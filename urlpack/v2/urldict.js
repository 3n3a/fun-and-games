/**
 * urldict — a hand-built dictionary for URL-shaped text.
 *
 * brotli-wasm exposes no custom-dictionary API, so this does the substitution a
 * dictionary would do, one layer earlier: common URL phrases are replaced with
 * single reserved bytes before the data ever reaches a compressor.
 *
 * The escape problem solves itself. TextEncoder emits valid UTF-8, and valid
 * UTF-8 never contains 0xC0, 0xC1, or 0xF5–0xFF — overlong forms and code
 * points past U+10FFFF. Those 13 bytes are therefore free for us to use as
 * tokens with no escaping, no ambiguity, and no risk of collision with
 * anything a user can type.
 *
 *   12 of them are one-byte tokens (profitable for any phrase >= 2 bytes)
 *   0xFF is a prefix: 0xFF + byte gives 256 more (profitable from 3 bytes up)
 *
 * The payoff is largest exactly where general-purpose compression fails: a
 * 20–60 byte URL is too short for Brotli to amortise its own frame, but
 * "https://www." collapsing to one byte is a flat 11-byte win regardless.
 *
 * DICT_VERSION is written into the packed header. Never edit PHRASES in place
 * once links exist in the wild — add a new version, keep the old array, and
 * old links keep resolving.
 */

export const DICT_VERSION = 1;

const SINGLE = [0xc0, 0xc1, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe];
const PREFIX = 0xff;

/**
 * Order matters: the first 12 entries get the one-byte tokens.
 *
 * Chosen by running a longest-match pass over a corpus of 71 URLs of the kind
 * people actually paste — YouTube, Amazon, Reddit, news sites, Google Docs,
 * WordPress blogs, shop listings, OAuth redirects — and keeping the phrases
 * that saved the most bytes. 136 of the 268 slots earned their place that way;
 * the rest are plausible entries filling slots that would otherwise sit empty.
 *
 * The one-byte twelve are pinned by hand rather than measured: 71 URLs is far
 * too small a sample to rank global frequency, and the difference between a
 * one- and two-byte token is only a single byte per occurrence.
 *
 * Measured, dictionary alone, before any compressor:
 *   tuning corpus   4507 -> 2635 bytes  (58%)
 *   held-out corpus  860 ->  615 bytes  (72%)
 * Trust the second number — the first one saw these phrases being chosen.
 */
export const PHRASES = [
  // --- the twelve one-byte tokens, in order ---
  "https://www.", "https://", "http://", ".com/", ".com", "www.", ".html", "%20", "utm_",
  ".org/", ".php", ".jpg",

  // --- two-byte tokens, ranked by measured bytes saved on the tuning corpus ---
  "play.google.com/store/apps/details?id=", "news.ycombinator.com/item?id=",
  "stackoverflow.com/questions/", "docs.google.com/document/d/",
  "raw.githubusercontent.com/", "drive.google.com/file/d/", "en.wikipedia.org/wiki/",
  "developer.mozilla.org/", "mail.google.com/mail/", "youtube.com/watch?v=",
  "web.archive.org/web/", "google.com/search?q=", "calendar.google.com/",
  "accounts.google.com/", "instagram.com/reel/", "&response_type=code",
  "netflix.com/title/", "booking.com/hotel/", "open.spotify.com/", "etsy.com/listing/",
  "airbnb.com/rooms/", "tripadvisor.com/", "theguardian.com/", "maps.google.com/",
  "linkedin.com/in/", "instagram.com/p/", "arstechnica.com/", "techcrunch.com/",
  "imdb.com/title/", "bbc.co.uk/news/", "apps.apple.com/", "/2026/", "/status/",
  "wordpress.com/", "dropbox.com/s/", "?redirect_uri=", "&utm_campaign=", "unsplash.com/",
  "trello.com/b/", "theverge.com/", "reddit.com/r/", "facebook.com/", "ebay.com/itm/",
  "calendly.com/", "amazon.co.uk/", "how-to-", "twitter.com/", "tiktok.com/@",
  "nytimes.com/", "expedia.com/", "chatgpt.com/", "?usp=sharing", "&utm_source=",
  "&utm_medium=", "&auto=format", "paypal.com/", "medium.com/", "google.com/",
  "github.com/", "amazon.com/", "?client_id=", "/index.html", "zoom.us/j/", "twitch.tv/",
  "notion.so/", "claude.ai/", "/products/", "/comments/", "youtu.be/", "/uploads/",
  "/support/", "/product/", "/article/", "&fit=crop", "best-", "-2026", "cnn.com/",
  "?igshid=", "/master/", "/images/", "?token=", "/video/", "/posts/", "-review", "&scope=",
  "&index=", "the-", "?si=", "-of-", "x.com/", "store.", "/docs/", "/blob/", "/2025/",
  "-with-", "-guide", "&list=", "%C3%BC", "%2F", "shop.", "blog.", "?ref=", "?dl=0",
  ".net/", ".blog", "&psc=", "how-", "cdn.", "/v2/", "/11/", "/09/", "/08/", "/07/", "/03/",
  "/02/", ".png", ".pdf", "-my-", "-in-", "&hl=", "?w=", "?v=", "?q=", ".js",

  // --- speculative: plausible but unseen in the corpus, filling free slots ---
  "-a-", "&q=", "%3A", "http://www.", "https://m.", "mailto:", "tel:", "localhost:",
  "127.0.0.1", "192.168.", ":8080", ":3000", "static.", "img.", "api.", "support.", "help.",
  "docs.", "news.", "mail.", "login.", "account.", "my.", "app.", ".org", ".net", ".io/",
  ".io", ".co/", ".co.uk/", ".co.uk", ".edu", ".gov", ".info", ".biz", ".dev/", ".app/",
  ".ai/", ".me/", ".tv/", ".xyz", ".shop", ".news", ".online", ".site", ".store", ".cloud",
  ".ch/", ".de/", ".fr/", ".it/", ".es/", ".nl/", ".se/", ".no/", ".at/", ".eu/", ".ru/",
  ".jp/", ".cn/", ".in/", ".br/", ".ca/", ".au/", ".uk/", ".us/", ".pl/", ".cz/", ".dk/",
  ".fi/", ".pt/", ".mx/", "/index.php", "/index.htm", "/blog/", "/news/", "/articles/",
  "/story/", "/post/", "/p/", "/item/", "/listing/", "/category/", "/categories/",
  "/collections/", "/tag/", "/tags/", "/topic/", "/search?", "/search/", "/search",
  "/results", "/user/", "/users/", "/profile/", "/account/", "/settings/", "/dashboard",
  "/login", "/signin", "/signup", "/register", "/logout", "/about", "/contact", "/help/",
  "/faq", "/documentation/", "/reference/", "/guide/", "/tutorial/", "/api/", "/api/v1/",
  "/api/v2/", "/v1/", "/assets/", "/static/", "/image/", "/img/", "/media/", "/files/",
  "/download/", "/downloads/", "/watch?v=", "/playlist?list=", "/embed/", "/videos/",
  "/photo/", "/photos/", "/gallery/", "/album/", "/shop/",
];

if (PHRASES.length > SINGLE.length + 256) throw new Error('dictionary too large');

/* Encoder index: first byte -> candidate phrases, longest first. */
const byFirstByte = new Map();
/* Decoder index: token code -> phrase bytes. */
const singleTable = new Array(256).fill(null);
const prefixTable = new Array(256).fill(null);

{
  const enc = new TextEncoder();
  PHRASES.forEach((phrase, i) => {
    const bytes = enc.encode(phrase);
    const token = i < SINGLE.length
      ? [SINGLE[i]]
      : [PREFIX, i - SINGLE.length];
    if (bytes.length <= token.length) return; // never a saving; skip it
    if (token.length === 1) singleTable[token[0]] = bytes;
    else prefixTable[token[1]] = bytes;
    const list = byFirstByte.get(bytes[0]) ?? [];
    list.push({ bytes, token });
    byFirstByte.set(bytes[0], list);
  });
  for (const list of byFirstByte.values()) list.sort((a, b) => b.bytes.length - a.bytes.length);
}

/**
 * Replace known phrases with tokens. Longest match wins at each position.
 * Output is never longer than the input.
 * @param {Uint8Array} bytes valid UTF-8
 * @returns {Uint8Array}
 */
export function substitute(bytes) {
  const out = new Uint8Array(bytes.length);
  let p = 0;
  let i = 0;
  outer: while (i < bytes.length) {
    const candidates = byFirstByte.get(bytes[i]);
    if (candidates) {
      for (const { bytes: phrase, token } of candidates) {
        const end = i + phrase.length;
        if (end > bytes.length) continue;
        let k = 1;
        while (k < phrase.length && bytes[i + k] === phrase[k]) k++;
        if (k === phrase.length) {
          for (const t of token) out[p++] = t;
          i = end;
          continue outer;
        }
      }
    }
    out[p++] = bytes[i++];
  }
  return out.subarray(0, p);
}

/**
 * Reverse of substitute().
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function restore(bytes) {
  const chunks = [];
  let plain = [];
  const flush = () => { if (plain.length) { chunks.push(Uint8Array.from(plain)); plain = []; } };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    let phrase = null;
    if (b === PREFIX) {
      if (i + 1 >= bytes.length) throw new Error('truncated dictionary token');
      phrase = prefixTable[bytes[++i]];
    } else if (b >= 0xc0) {
      phrase = singleTable[b];
    }
    if (phrase) { flush(); chunks.push(phrase); } else { plain.push(b); }
  }
  flush();
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
