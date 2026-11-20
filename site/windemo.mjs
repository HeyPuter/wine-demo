// windemo's loader: the ejected Wine desktop (gexc eject + eject-site.mjs: its
// project/build/web/nt.json and the files it names) started on the gex
// runtime package (rt/, @gexemu/runtime) through its public API alone. The
// policy is the site's: which files come first and how (the title archive
// and its pieces, packed per pack.json), where the rest come from (the rest
// bundle, by site/lazy-source.mjs), what the loading screen is told, and the
// Wine environment's defaults.
//
// start(options) -> handle, as index.html uses it:
//   container       the element the desktop fills
//   size            'fit', 'WxH' or { w, h }
//   args            the program's arguments (default the launch file's)
//   launch          in place of the site's launch file (nt.json) and pack: { exe, argv,
//                   env: ['K=V', ...], cwd, size, tar: the archive's path (plain), d3d,
//                   features_off } (the recording page, tools/pre-index.html)
//   scale           device pixels per CSS pixel the desktop draws at: 1 (the default, CSS
//                   pixels), a number, or 'auto' (the page's devicePixelRatio at the start)
//   env             ['K=V', ...] over the launch's environment
//   background      the desktop behind the windows: '#rrggbb' or { color, image, anchor }
//   filesystem      'memory' or { kind: 'opfs', name }
//   onStoreBusy({ name, signal })  another tab holds the store: resolves 'memory'
//                   (run without keeping files) or 'wait' (until it lets go; `signal`
//                   aborts once it has)
//   wisp            a Wisp proxy's URL for the guest's network
//   restAhead       the rest bundle downloaded whole in the background once the
//                   system is up (paused while the page is hidden); default true,
//                   false: each frame at its first read
//   debug           the runtime's debugging switches ({ cpus, log, systime, glcapture })
//   onProgress(p)   the start-up: { phase: 'download' | 'boot' | 'ready' | 'failed' | 'exited',
//                   download: { done, total, files, filesDone }, fetch, rest: { done,
//                   total, complete } (restAhead's), error }
//   onCrash(c), onNotice(n), onLog(text), onGlCapture(bytes)
// handle: { exited, state, system, filesystem, launch (what ran: the launch with the
//   environment Wine got), resize(size), drop(data, opts), dragLeave(), describe(opts), kill() }

import { System, hostTimeZone } from '../rt/index.mjs';
import { MemoryFilesystem, OPFSFilesystem } from '../rt/fs.mjs';
import { CompositorWindows } from '../rt/windows-compositor.mjs';
import { MesaGl } from '../rt/gl.mjs';
import { HostDrop } from '../rt/drop.mjs';

const LAUNCH = 'project/build/web/nt.json';
const ZSTD = 'vendor/zstddec-stream.mjs';
/** The rest bundle's frames kept across visits. */
const FRAME_CACHE = 'windemo-rest-v1';

const json = async (url, what) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${what ?? url}: ${r.status} ${r.statusText}`);
  return r.json();
};

/** `KEY=VALUE` strings as an object, later names winning. */
const envObject = (list) => Object.fromEntries((list ?? []).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));

/** The paths of a tar's hard links (type '1'): a piece's copy must not replace one. */
function hardLinks(tar) {
  const out = new Set();
  const dec = new TextDecoder();
  const field = (at, n) => dec.decode(tar.subarray(at, at + n)).replace(/\0.*$/s, '');
  let longName = null;
  let paxPath = null;
  for (let at = 0; at + 512 <= tar.length;) {
    if (tar[at] === 0) break;
    const size = parseInt(field(at + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(tar[at + 156]);
    const body = tar.subarray(at + 512, at + 512 + size);
    const prefix = field(at + 345, 155);
    const name = paxPath ?? longName ?? (prefix ? `${prefix}/${field(at, 100)}` : field(at, 100));
    if (type === 'L') longName = dec.decode(body).replace(/\0.*$/s, '');
    else if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(dec.decode(body));
      paxPath = m ? m[1] : null;
    } else {
      if (type === '1') out.add(`/${name.replace(/^\.?\/+/, '')}`);
      longName = null;
      paxPath = null;
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

export async function start(opts = {}) {
  const base = new URL('..', import.meta.url);
  const at = (p) => new URL(String(p).replace(/^\/+/, ''), base).href;
  const state = { phase: 'fetching', out: '', progress: null, status: null, error: null };
  const say = (s) => {
    state.out = (state.out + s).slice(-200000);
    opts.onLog?.(s);
  };
  const p = { phase: 'download', download: { done: 0, total: 0, files: 0, filesDone: 0 }, fetch: null };
  const emit = () => {
    state.progress = { ...p, download: { ...p.download } };
    opts.onProgress?.(state.progress);
  };

  if (!globalThis.crossOriginIsolated) throw new Error('This page needs cross-origin isolation for its threads: serve it with the headers Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp (the site\'s _headers do).');
  if (!navigator.gpu) throw new Error('This browser has no WebGPU, which the desktop draws with. Use a recent desktop Chrome or Edge with hardware acceleration on.');

  const [nt, pack] = opts.launch ? [opts.launch, {}] : await Promise.all([json(at(LAUNCH), 'the launch file'), json(at('pack.json')).catch(() => ({}))]);
  const params = nt.params ?? {};
  const packed = (path) => pack.files?.[`/${String(path).replace(/^\/+/, '')}`] ?? null;
  const zstd = (async () => {
    const { ZSTDDecoder } = await import(/* @vite-ignore */ at(ZSTD));
    const d = new ZSTDDecoder();
    await d.init();
    return d;
  })();
  /** A site file's bytes: its packed copy (FILE.zst, pack.json's), decoded, or the file; counted for the progress. */
  const bytes = async (path) => {
    const e = packed(path);
    const u = new URL(at(e ? `${path}.zst` : path));
    if (e && pack.build) u.search = `v=${pack.build}`;
    const r = await fetch(u.href);
    if (!r.ok) throw new Error(`${path}: ${r.status} ${r.statusText}`);
    const reader = r.body.getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      n += value.length;
      p.download.done += value.length;
      emit();
    }
    const all = new Uint8Array(n);
    let o = 0;
    for (const v of parts) { all.set(v, o); o += v.length; }
    p.download.filesDone++;
    emit();
    if (!e) return all;
    const out = (await zstd).decode(all, e.size);
    if (out.length !== e.size) throw new Error(`${path}: decoded ${out.length} of ${e.size} bytes`);
    return out;
  };

  // Where the guest's files are kept. An OPFS store is held by one tab at a time: another tab's is the
  // page's choice (onStoreBusy), and a wait ends once it lets go.
  let where = opts.filesystem ?? nt.start?.filesystem ?? 'memory';
  if (where?.kind === 'opfs' && await OPFSFilesystem.busy(where.name)) {
    if (!opts.onStoreBusy) throw Object.assign(new Error(`the store ${where.name} is open in another tab or window of this site`), { code: 'EBUSY' });
    const freed = new AbortController();
    const watch = (async () => {
      while (await OPFSFilesystem.busy(where.name)) await new Promise((r) => setTimeout(r, 500));
      freed.abort();
      return 'wait';
    })();
    const choice = await Promise.race([Promise.resolve(opts.onStoreBusy({ name: where.name, signal: freed.signal })), watch]);
    if (choice === 'memory') where = 'memory';
    else await watch;
  }
  const keep = where?.kind === 'opfs';

  const sys = new System({ arch: 'x86', debug: { ...(opts.debug ?? {}) } });
  const fs = keep ? new OPFSFilesystem(sys, { name: where.name, wait: true }) : new MemoryFilesystem(sys);

  // The lazy files: this site's source (lazy-source.mjs) in the runtime's Worker.
  if (params.lazy) {
    fs.setLazySource(new URL('./lazy-source.mjs', import.meta.url), {
      data: { base: at(params.lazy.replace(/[^/]*$/, '')), zstd: at(ZSTD), cache: FRAME_CACHE },
    });
  }
  // The counts first, so the progress is whole from its first figure.
  const tarPath = nt.tar ?? 'project/build/web/rootfs.tar';
  const pieceList = params.pieces ? await json(at(params.pieces), 'the pieces\' list') : null;
  for (const path of [tarPath, ...(pieceList?.pieces ?? []).map(([u]) => u), ...(params.lazy ? [params.lazy] : [])]) {
    p.download.files++;
    p.download.total += packed(path)?.zsize ?? 0;
  }
  emit();
  const lazyList = params.lazy ? bytes(params.lazy).then((b) => JSON.parse(new TextDecoder().decode(b))) : null;
  const tar = await bytes(tarPath);
  fs.addTar(tar);
  if (pieceList) {
    // The archive holds each such file empty (its mode, its time); its bytes are a piece's. A hard link
    // stays one (glibc and Wine know a file by its inode).
    const hard = hardLinks(tar);
    const pieces = new Array(pieceList.pieces.length);
    let next = 0;
    const one = async () => {
      while (next < pieces.length) {
        const i = next++;
        pieces[i] = await bytes(pieceList.pieces[i][0]);
      }
    };
    await Promise.all([one(), one(), one(), one()]);
    const files = {};
    for (const [path, i, off, n] of pieceList.files) if (!hard.has(path)) files[path] = pieces[i].subarray(off, off + n);
    fs.addFiles(files);
  }
  // lazy.json: [path, size, key, mtime, mode]; the runtime's list is [path, size, key, mode, mtime].
  const lazy = lazyList ? (await lazyList).files : [];
  const names = new Map(lazy.map(([path, size, key]) => [key, path.split('/').pop()]));
  if (lazy.length) fs.addTar(null, { lazy: lazy.map(([path, size, key, mtime, mode]) => [path, size, key, mode ?? undefined, mtime ?? undefined]) });
  // The prefix's DOS attributes (user.DOSATTRIB), on the tar's files and the
  // lazy ones alike: last, over every layer.
  if (nt.xattrs && Object.keys(nt.xattrs).length) fs.addTar(null, { xattrs: nt.xattrs });

  // The desktop: one canvas, the scene compositor's.
  const container = opts.container ?? document.body;
  const fit = () => [Math.max(640, container.clientWidth || innerWidth), Math.max(480, container.clientHeight || innerHeight)];
  const sizeOf = (s) => {
    if (s === 'fit' || s == null) return fit();
    if (typeof s === 'string') return s.split('x').map(Number);
    return [Number(s.w ?? s.width), Number(s.h ?? s.height)];
  };
  let [w, h] = sizeOf(opts.size ?? nt.size);
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  // The backing store in device pixels, the page's CSS size times the scale.
  const scale = opts.scale === 'auto' ? Math.max(1, Number(globalThis.devicePixelRatio) || 1) : Math.max(1, Number(opts.scale ?? 1) || 1);
  const dev = (n) => Math.max(1, Math.round(n * scale));
  canvas.width = dev(w);
  canvas.height = dev(h);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  container.append(canvas);
  const windows = new CompositorWindows(sys, { canvas, scale, ...(opts.background ? { background: opts.background } : {}) });
  // index.html reads the scene's windows (the agent's status windows) here.
  globalThis.__gexCompositor = { describe: (o) => windows.describe(o) };
  if (!(nt.features_off ?? []).includes('gl')) new MesaGl(sys, { d3d: !!nt.d3d });
  const drop = new HostDrop(sys, { windows });
  if (opts.onGlCapture) globalThis.__gexGlCaptureSink = opts.onGlCapture;

  sys.addEventListener('crash', (e) => opts.onCrash?.({ pid: e.pid, name: e.name, reason: e.reason, code: e.code, signal: e.signal, cmdline: e.cmdline }));
  sys.addEventListener('notice', (e) => opts.onNotice?.({ pid: e.pid, name: e.name, text: e.text, cmdline: e.cmdline }));
  sys.addEventListener('failed', (e) => {
    state.error = String(e.error?.stack ?? e.error);
    p.phase = 'failed';
    p.error = state.error;
    emit();
  });
  sys.addEventListener('console', (e) => say(e.text));

  p.phase = 'boot';
  emit();
  state.phase = 'booting';
  await sys.boot();
  if (opts.wisp) {
    const { Wisp } = await import('../rt/net-wisp.mjs');
    sys.network = new Wisp(String(opts.wisp));
  }
  // What the lazy source is fetching, for the progress line, by the file's name.
  fs.lazyPort?.addEventListener('message', ({ data: m }) => {
    if (m.rest) { p.rest = { ...m.rest, complete: false }; emit(); }
    if (m.ahead?.done) { p.rest = { ...(p.rest ?? { done: 0, total: 0 }), complete: true }; emit(); }
    if (!('fetch' in m)) return;
    p.fetch = m.fetch && { kind: 'file', name: names.get(m.fetch.key) ?? m.fetch.key, done: m.fetch.done, total: m.fetch.total, inflight: m.fetch.inflight };
    if (p.phase === 'ready') emit();
  });
  fs.lazyPort?.start();
  // The rest bundle whole in the background (lazy-source.mjs `ahead`), the title files being in.
  const restBundles = [...new Set(lazy.map(([, , key]) => String(key)).filter((k) => k.includes('#')).map((k) => k.slice(0, k.lastIndexOf('#'))))];
  if (opts.restAhead !== false && fs.lazyPort && restBundles.length) {
    const paused = () => fs.lazyPort.postMessage({ paused: document.visibilityState === 'hidden' });
    paused();
    fs.lazyPort.postMessage({ ahead: { bundles: restBundles } });
    document.addEventListener('visibilitychange', paused);
  }

  // Wine's environment: the launch file's, the windows', the viewer's time zone, and the site's defaults.
  const env = { ...envObject(nt.env), ...windows.env, ...hostTimeZone(), ...envObject(opts.env ?? []) };
  env.GEX_WINE_PREFIX ??= '/wine';
  env.GEX_WIN_STRICT ??= '1';
  // The wineserver's periodic registry saves only for a prefix the visit keeps.
  if (keep) delete env.WINEGEX_NO_REGSAVE;
  else env.WINEGEX_NO_REGSAVE = '1';
  const argv = [nt.exe, ...(opts.args ?? nt.argv ?? [])];
  state.phase = 'running';
  const proc = sys.spawn(argv, { env, cwd: nt.cwd ?? '/' });
  const pump = (s) => s.pipeTo(new WritableStream({ write: (b) => say(new TextDecoder().decode(b)) })).catch(() => {});
  pump(proc.stdout);
  pump(proc.stderr);

  // A kept prefix's registry on disk before the tab may go: the wineserver
  // saves it at SIGUSR1, writing each changed hive (a new file, or in place
  // when it has other links), then the root is synced. The save is over once
  // a hive changed and none has for a moment, or after a while with none
  // changed (nothing to save). Watched through the filesystem, not timers: a
  // hidden page's timers are slowed to a second or more. Each time the page
  // is hidden, and as it is let go.
  if (keep && typeof sys.signal === 'function') {
    const SAVE_MS = 1500, SETTLE_MS = 40;
    const hives = env.WINEPREFIX ? ['system.reg', 'user.reg', 'userdef.reg'].map((f) => `${env.WINEPREFIX}/${f}`) : [];
    const marks = () => Promise.all(hives.map((h) => fs.stat(h).then((st) => `${st.ino} ${st.size} ${+st.mtime}`, () => null)));
    const saved = async (before) => {
      const t0 = performance.now();
      let last = 0;
      for (let prev = before; performance.now() - t0 < SAVE_MS;) {
        const now = await marks();
        if (now.some((v, i) => v !== prev[i])) [prev, last] = [now, performance.now()];
        else if (last && performance.now() - last > SETTLE_MS) return;
      }
    };
    let flushing = null;
    const flush = () => {
      if (flushing || sys.state.phase !== 'running') return;
      flushing = (async () => {
        const before = await marks();
        if (await sys.signal('wineserver', 'SIGUSR1').then(() => true, () => false)) await saved(before);
        await sys.sync();
      })().catch(() => {}).finally(() => { flushing = null; });
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    addEventListener('pagehide', flush);
  }

  // Ready: the desktop's first window drawn.
  const ready = setInterval(async () => {
    const d = await windows.describe({ pixels: false }).catch(() => null);
    if (!d?.frames || !(d.list ?? []).length || p.phase !== 'boot') return;
    clearInterval(ready);
    p.phase = 'ready';
    emit();
  }, 100);
  const exited = proc.exited.then((r) => {
    clearInterval(ready);
    state.status = r?.code ?? r;
    state.phase = 'done';
    p.phase = 'exited';
    emit();
    return state.status;
  }, (e) => {
    clearInterval(ready);
    state.error = String(e?.stack ?? e);
    state.phase = 'failed';
    p.phase = 'failed';
    p.error = state.error;
    emit();
    throw e;
  });

  return {
    exited,
    state,
    system: sys,
    filesystem: fs,
    // (without the registry-save knob: this loader decides it each visit, by where the files are kept, and a
    // recording made on a memory filesystem must not hand it to a visit that keeps them)
    launch: { ...nt, argv: argv.slice(1), env: Object.entries(env).filter(([k]) => k !== 'WINEGEX_NO_REGSAVE').map(([k, v]) => `${k}=${v}`) },
    resize(size = 'fit') {
      [w, h] = sizeOf(size);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      windows.resize(dev(w), dev(h));
      return { w, h };
    },
    describe: (o) => windows.describe(o),
    // Call it in the drop event's handler, before anything there awaits.
    drop: (data, o) => drop.drop(data, o),
    dragOver: (x, y) => drop.windowAt(x, y),
    dragLeave() {},
    kill() {
      sys.shutdown().catch(() => {});
    },
  };
}
