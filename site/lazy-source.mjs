// windemo's lazy files (the runtime's Filesystem.setLazySource): imported into
// the runtime's Worker that answers every program's read of a file not yet in
// the guest. Each key is lazy.json's: `BUNDLE#OFFSET`, a file at OFFSET of a
// rest bundle (zstd frames of FRAME bytes each, indexed by BUNDLE.json), or a
// path under the lazy files' base, read by ranged requests.
//
// A rest bundle's frames are fetched by range, one request per frame however
// many reads want it, decoded here with one decoder, the last few kept
// decoded and the rest kept compressed in memory. A bundle whose index names
// its hash keeps its compressed frames in the page's Cache Storage, so a later
// visit reads them from there; an earlier build's frames go once it is seen.
//
// What is being fetched goes to the page over the port (`{ fetch: { key,
// done, total, inflight } }`, `{ fetch: null }` once nothing is): its
// progress line names the file.
//
// init's data: { base: the lazy files' base URL, zstd: the decoder module's
// URL, cache: the Cache Storage name or null }.

let base, zstdUrl, cacheName, port;
let decoder = null;
let store = null;

/** BUNDLE URL -> promise of its index { frame, size, h, frames: [[offset, length], ...] }. */
const bundles = new Map();
/** `URL#k` -> promise of the decoded frame; most recently used last. */
const decoded = new Map();
const DECODED_KEPT = 4;
/** `URL#k` -> compressed frame; most recently used last, up to PACKED_BUDGET bytes. */
const packed = new Map();
const PACKED_BUDGET = 96 << 20;
let packedBytes = 0;
/** `URL#k` -> promise of the compressed frame, while it is fetched. */
const fetching = new Map();
/** What the page is told is in flight: key -> { done, total }. */
const inflight = new Map();

export async function init(ctx) {
  ({ base, zstd: zstdUrl, cache: cacheName } = ctx.data);
  port = ctx.port;
  if (cacheName && typeof caches === 'object') store = await caches.open(cacheName).catch(() => null);
}

const tell = () => {
  let last = null;
  for (const [key, f] of inflight) last = { key, ...f };
  port?.postMessage({ fetch: last && { ...last, inflight: inflight.size } });
};

async function zstd() {
  decoder ??= import(/* @vite-ignore */ zstdUrl).then(async ({ ZSTDDecoder }) => {
    const d = new ZSTDDecoder();
    await d.init();
    return d;
  });
  return decoder;
}

/** Bytes [lo, hi) of `url`, a few tries with waits between. */
async function range(url, lo, hi) {
  let err = null;
  for (let i = 0; i < 4; i++) {
    if (i) await new Promise((r) => setTimeout(r, 250 * 2 ** i));
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${lo}-${hi - 1}` }, cache: 'no-store' });
      if (r.status === 206) {
        const b = new Uint8Array(await r.arrayBuffer());
        if (b.length === hi - lo) return b;
        err = new Error(`${url} @${lo}: ${b.length} of ${hi - lo} bytes`);
      } else if (r.status === 200) {
        // A host that ignores Range: the range cut from the whole answer.
        const b = new Uint8Array(await r.arrayBuffer());
        if (b.length >= hi) return b.slice(lo, hi);
        err = new Error(`${url}: ${b.length} bytes, short of ${hi}`);
      } else {
        err = new Error(`${url} @${lo}: ${r.status}`);
      }
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

function bundle(url) {
  let b = bundles.get(url);
  if (!b) {
    b = fetch(`${url}.json`).then((r) => {
      if (!r.ok) throw new Error(`${url}.json: ${r.status}`);
      return r.json();
    });
    b.then((ix) => dropOld(url, ix.h), () => bundles.delete(url));
    bundles.set(url, b);
  }
  return b;
}

const frameKey = (url, h, k) => {
  const u = new URL(url);
  u.search = `h=${h}&f=${k}`;
  return u.href;
};

/** Frames kept in the page's cache under another hash than `h`: an earlier build's. */
async function dropOld(url, h) {
  if (!store || !h) return;
  try {
    const path = new URL(url).pathname;
    for (const r of await store.keys()) {
      const u = new URL(r.url);
      if (u.pathname === path && u.searchParams.has('f') && u.searchParams.get('h') !== h) await store.delete(r);
    }
  } catch { /* kept */ }
}

function keepPacked(key, z) {
  const old = packed.get(key);
  if (old) { packed.delete(key); packedBytes -= old.length; }
  packed.set(key, z);
  packedBytes += z.length;
  for (const [k, v] of packed) {
    if (packedBytes <= PACKED_BUDGET) break;
    packed.delete(k);
    packedBytes -= v.length;
  }
}

/** Frame `k` of `url`, compressed: from memory, the page's cache, or the network. */
async function compressed(url, ix, k) {
  const key = `${url}#${k}`;
  const z = packed.get(key);
  if (z) {
    packed.delete(key);
    packed.set(key, z);
    return z;
  }
  let p = fetching.get(key);
  if (p) return p;
  p = (async () => {
    if (store && ix.h) {
      const r = await store.match(frameKey(url, ix.h, k)).catch(() => null);
      if (r?.ok) return new Uint8Array(await r.arrayBuffer());
    }
    const [o, n] = ix.frames[k];
    const got = await range(url, o, o + n);
    if (store && ix.h) store.put(frameKey(url, ix.h, k), new Response(got)).catch(() => {});
    return got;
  })().then((got) => {
    keepPacked(key, got);
    return got;
  }).finally(() => fetching.delete(key));
  fetching.set(key, p);
  return p;
}

function frame(url, ix, k) {
  const key = `${url}#${k}`;
  let p = decoded.get(key);
  if (p) {
    decoded.delete(key);
    decoded.set(key, p);
    return p;
  }
  p = (async () => {
    const z = await compressed(url, ix, k);
    const size = Math.min(ix.frame, ix.size - k * ix.frame);
    const out = (await zstd()).decode(z, size);
    if (out.length !== size) throw new Error(`${url} frame ${k}: decoded ${out.length} of ${size} bytes`);
    return out;
  })();
  p.catch(() => decoded.delete(key));
  decoded.set(key, p);
  while (decoded.size > DECODED_KEPT) decoded.delete(decoded.keys().next().value);
  return p;
}

export async function read(key, offset, length) {
  const hash = key.lastIndexOf('#');
  const busy = { done: 0, total: length };
  inflight.set(key, busy);
  tell();
  try {
    if (hash < 0) return await range(new URL(key, base).href, offset, offset + length);
    const url = new URL(key.slice(0, hash), base).href;
    const at = Number(key.slice(hash + 1)) + offset;
    const ix = await bundle(url);
    const out = new Uint8Array(length);
    for (let pos = at; pos < at + length;) {
      const k = Math.floor(pos / ix.frame);
      const f = await frame(url, ix, k);
      const off = pos - k * ix.frame;
      const n = Math.min(f.length - off, at + length - pos);
      if (n <= 0) throw new Error(`${key} @${offset}: past the bundle's end`);
      out.set(f.subarray(off, off + n), pos - at);
      pos += n;
      busy.done = pos - at;
    }
    return out;
  } finally {
    inflight.delete(key);
    tell();
  }
}
