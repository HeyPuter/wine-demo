// windemo's lazy files (the runtime's Filesystem.setLazySource): imported into
// the runtime's Worker that answers every program's read of a file not yet in
// the guest. Each key is lazy.json's: `BUNDLE#OFFSET`, a file at OFFSET of a
// rest bundle (zstd frames of FRAME bytes each, indexed by BUNDLE.json), or a
// path under the lazy files' base, read by ranged requests.
//
// A rest bundle's frames are fetched by range, one request per frame however
// many reads want it, decoded here with one decoder, the most recent kept
// decoded up to a byte budget and the rest kept compressed in memory. A frame
// or index that could not be had is given up for a while: the reads that
// want it fail at once (EIO) rather than each waiting out its own retries. A bundle whose index names
// its hash keeps its compressed frames in the page's Cache Storage, so a later
// visit reads them from there; an earlier build's frames go once it is seen.
//
// What is being fetched goes to the page over the port (`{ fetch: { key,
// done, total, inflight } }`, `{ fetch: null }` once nothing is): its
// progress line names the file.
//
// The page may ask for the rest bundles whole in the background (`{ ahead:
// { bundles: [URL, ...] } }` over the port, `{ paused: true | false }` while
// it is hidden): frame after frame not held yet, at low priority, one at a
// time and none while a read waits (a read cuts the frame in flight short),
// into the page's cache (into memory up to its budget without one), so the
// reads after find them there. Once done: `{ ahead: { frames, bytes, done:
// true } }`; `{ rest: { done, total } }` (compressed bytes) as it goes.
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
// Kept by bytes, not count (8 MiB frames: eight of them): a program's start
// maps image after image, each image's headers in another frame, and a few
// kept decode the same frames again and again. At least two, whatever their size.
const DECODED_BUDGET = 64 << 20;
const DECODED_KEPT_MIN = 2;
/** The decoded frames' sizes, `URL#k` -> bytes, once each is decoded. */
const decodedBytes = new Map();
let decodedTotal = 0;
/** What failed, `URL#k` or an index's URL -> the time it may be tried again. */
const failedUntil = new Map();
const FAILED_HOLD_MS = 30000;
/** `URL#k` -> compressed frame; most recently used last, up to PACKED_BUDGET bytes. */
const packed = new Map();
const PACKED_BUDGET = 96 << 20;
let packedBytes = 0;
/** `URL#k` -> promise of the compressed frame, while it is fetched. */
const fetching = new Map();
/** What the page is told is in flight: key -> { done, total }. */
const inflight = new Map();
/** Reads in flight (the background download waits for none). */
let reading = 0;

export async function init(ctx) {
  ({ base, zstd: zstdUrl, cache: cacheName } = ctx.data);
  port = ctx.port;
  if (cacheName && typeof caches === 'object') store = await caches.open(cacheName).catch(() => null);
  port?.addEventListener('message', ({ data: m }) => {
    if (typeof m?.paused === 'boolean') { aheadPaused = m.paused; if (m.paused) aheadAbort?.abort(); wakeAhead(); }
    if (m?.ahead?.bundles) ahead(m.ahead.bundles.map((u) => new URL(u, base).href));
  });
  port?.start();
}

// The background download (`ahead`): paused while the page is hidden, waiting
// while a read is in flight (`reading`), its frame in flight cut short by a
// read's start.
let aheadPaused = false, aheadRunning = false, aheadAbort = null, aheadWaiter = null;
function wakeAhead() {
  const w = aheadWaiter;
  aheadWaiter = null;
  w?.();
}
const thrifty = () => {
  const c = globalThis.navigator?.connection;
  return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType ?? '')));
};

/** Whether frame `k` of `url` is had already: in memory or in the page's cache. */
async function hasFrame(url, ix, k) {
  const key = `${url}#${k}`;
  if (packed.has(key) || decodedBytes.has(key)) return true;
  if (!store || !ix.h) return false;
  return !!(await store.match(frameKey(url, ix.h, k)).catch(() => null));
}

async function ahead(urls) {
  if (aheadRunning) return;
  aheadRunning = true;
  let frames = 0, bytes = 0, done = 0, total = 0, told = 0;
  const progress = (force) => {
    if (!force && performance.now() - told < 250) return;
    told = performance.now();
    port?.postMessage({ rest: { done, total } });
  };
  try {
    const want = [];
    for (const url of urls) {
      let ix;
      try { ix = await bundle(url); } catch { continue; }
      for (let k = 0; k < ix.frames.length; k++) {
        if (!(await hasFrame(url, ix, k))) { want.push([url, ix, k]); total += ix.frames[k][1]; }
      }
    }
    progress(true);
    for (const [url, ix, k] of want) {
      const key = `${url}#${k}`;
      const n = ix.frames[k][1];
      for (let fails = 0; ;) {
        while (aheadPaused || reading) await new Promise((r) => { aheadWaiter = r; });
        if (thrifty()) return;
        // (a read may have brought it meanwhile)
        if (fetching.has(key)) { await fetching.get(key).catch(() => {}); continue; }
        if (await hasFrame(url, ix, k)) break;
        if (held(key)) break;
        // Without the page's cache the frames are kept in memory, up to its budget.
        if (!(store && ix.h) && packedBytes + n > PACKED_BUDGET) return;
        const ac = (aheadAbort = new AbortController());
        try {
          const [o] = ix.frames[k];
          const got = await range(url, o, o + n, { signal: ac.signal, tries: 1 });
          if (store && ix.h) await store.put(frameKey(url, ix.h, k), new Response(got)).catch(() => keepPacked(key, got));
          else keepPacked(key, got);
          frames++;
          bytes += n;
          break;
        } catch {
          // (cut short for a read or a pause: no failure)
          if (ac.signal.aborted) continue;
          if (++fails > 4) break;
          await new Promise((r) => setTimeout(r, 2000 << (fails - 1)));
        } finally {
          if (aheadAbort === ac) aheadAbort = null;
        }
      }
      done += n;
      progress();
    }
  } finally {
    aheadRunning = false;
    progress(true);
    port?.postMessage({ ahead: { frames, bytes, done: true } });
  }
}

function held(key) {
  const t = failedUntil.get(key);
  if (t === undefined) return false;
  if (Date.now() < t) return true;
  failedUntil.delete(key);
  return false;
}
const failed = (key) => failedUntil.set(key, Date.now() + FAILED_HOLD_MS);
const heldError = (key) => new Error(`${key}: failed less than ${FAILED_HOLD_MS / 1000} s ago`);

function dropDecoded(key) {
  decoded.delete(key);
  const n = decodedBytes.get(key);
  if (n !== undefined) { decodedBytes.delete(key); decodedTotal -= n; }
}
function trimDecoded() {
  for (const k of decoded.keys()) {
    if (decodedTotal <= DECODED_BUDGET || decoded.size <= DECODED_KEPT_MIN) break;
    dropDecoded(k);
  }
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

/** Bytes [lo, hi) of `url`, a few tries with waits between (the background's: one, low priority, abortable). */
async function range(url, lo, hi, { signal, tries = 4 } = {}) {
  let err = null;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, 250 * 2 ** i));
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${lo}-${hi - 1}` }, cache: 'no-store', ...(signal && { signal, priority: 'low' }) });
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
    if (held(url)) return Promise.reject(heldError(url));
    b = fetch(`${url}.json`).then((r) => {
      if (!r.ok) throw new Error(`${url}.json: ${r.status}`);
      return r.json();
    });
    b.then((ix) => dropOld(url, ix.h), () => { bundles.delete(url); failed(url); });
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
  if (held(key)) return Promise.reject(heldError(key));
  p = (async () => {
    const z = await compressed(url, ix, k);
    const size = Math.min(ix.frame, ix.size - k * ix.frame);
    const out = (await zstd()).decode(z, size);
    if (out.length !== size) throw new Error(`${url} frame ${k}: decoded ${out.length} of ${size} bytes`);
    return out;
  })();
  p.then((v) => {
    // Still kept: counted, and the budget kept.
    if (decoded.get(key) !== p || decodedBytes.has(key)) return;
    decodedBytes.set(key, v.length);
    decodedTotal += v.length;
    trimDecoded();
  }, () => {
    if (decoded.get(key) === p) dropDecoded(key);
    failed(key);
  });
  decoded.set(key, p);
  trimDecoded();
  return p;
}

export async function read(key, offset, length) {
  const hash = key.lastIndexOf('#');
  const busy = { done: 0, total: length };
  inflight.set(key, busy);
  reading++;
  aheadAbort?.abort();
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
    if (!--reading) wakeAhead();
  }
}
