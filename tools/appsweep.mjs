// appsweep.mjs URL OUTDIR PLAN.json: one app's install-and-run check on the windemo page in headless Chromium.
// The installer reaches the guest the way a visitor's does (dragged from the host onto the page); cmd runs it
// and its exit status comes back as cmd's window title; then the installed program is started and must show
// a window, and one interaction (a click in it and a few keys) must leave it alive.
// PLAN: {id, drop: [host paths], install: "cmd line" | null, interactive: [steps] | null, launch: "cmd line",
//        title: "regex" (the program's window; default any new window), timeout: {install, launch} s,
//        launch_steps: [steps] (its own dialogs on the way to that window), settle: ms, settle_shots: s,
//        dismiss: [{in: regex, alt|key}] (boxes answered while waiting, named in the notes), okrc: [codes], use: [steps],
//        restarts: N, reload: true, image: "x.exe" (the memory64 fallback's starts: restarts() below)}
// A tile's flow instead (tile: the launcher tile's name; bring: a host path, the installer a bring-your-own tile
// is given through its dialog's file input): the launcher's tile is clicked, the installer it runs gets the
// installer windows' default buttons (Alt+A first, an "I accept" box, unless accept: false; every `every` s, 6
// by default) until the program's window (title) is up, which the page's agent starts; no drop, cmd install
// or cmd launch. The URL is the launcher's (no ?desktop=1).
// Steps (interactive installs, and `after`): {wait: "regex", t}, {key: "Enter"|"Tab"|...}, {alt: "n"}, {ctrl: "`"},
//        {type: "text"}, {click: [x, y]} (in: "regex": x, y in that window), {sleep: s}, {shot: name, page: true (the whole page, its notes too)}, {gone: "regex", t}, {cmd: "line"} (typed into the driver's console),
//        {press: "Enter", until: "regex", alt: "a", every: s, t} (the key, each `every` s, until no window matches)
// Writes OUTDIR/console.txt, OUTDIR/out.txt (the program's terminal output), OUTDIR/*.png (the compositor's readout) and OUTDIR/result.json:
//   {id, drop, install, launch, usable, first_error, times}
// Env: CHROME (default /usr/bin/chromium), APPSWEEP_GPU=1 (Vulkan instead of SwiftShader), APPSWEEP_KEEP_PROFILE=1
// (the Chromium profile is not deleted at the end).
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, appendFileSync, openSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Cdp } from './cdp.mjs';

const [url, outDir, planPath] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
mkdirSync(outDir, { recursive: true });
const T0 = Date.now();
const now = () => (Date.now() - T0) / 1000;
const stamp = () => now().toFixed(1).padStart(7);
const log = (m) => appendFileSync(`${outDir}/console.txt`, `${stamp()} [sweep] ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = { id: plan.id, drop: null, install: null, launch: null, usable: null, first_error: null, times: {}, notes: [] };
const done = (why) => {
  if (why) res.notes.push(why);
  res.wall = Math.round(now());
  writeFileSync(`${outDir}/result.json`, JSON.stringify(res, null, 1) + '\n');
  try { chrome.kill('SIGKILL'); } catch {}
  // APPSWEEP_KEEP_PROFILE=1: the profile stays (its OPFS store, to read what a reload restored)
  if (!process.env.APPSWEEP_KEEP_PROFILE) rmSync(`${outDir}/profile`, { recursive: true, force: true });
  process.exit(0);
};

// PNG of the compositor's readout (the browser's own screenshot misses a GPU WebGPU canvas)
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 3 })), chunk('IEND', Buffer.alloc(0))]);
}

const prof = `${outDir}/profile`;
// APPSWEEP_SCREEN=W,H: the browser window's size (default 1300,800); the guest's screen is then read from the page's canvas
const SCREEN = /^\d+,\d+$/.test(process.env.APPSWEEP_SCREEN ?? '') ? process.env.APPSWEEP_SCREEN : '1300,800';
rmSync(prof, { recursive: true, force: true });
const chrome = spawn(process.env.CHROME || '/usr/bin/chromium', [
  '--headless', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu',
  ...(process.env.APPSWEEP_GPU ? ['--use-angle=vulkan', '--enable-features=Vulkan'] : ['--use-angle=swiftshader-webgl', '--use-webgpu-adapter=swiftshader']),
  '--ozone-platform=headless', `--ozone-override-screen-size=${SCREEN}`, `--window-size=${SCREEN}`,
  process.env.SMOKE_SPKI ? `--ignore-certificate-errors-spki-list=${process.env.SMOKE_SPKI}` : '--ignore-certificate-errors',
  '--disable-hang-monitor', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  '--remote-debugging-port=0', `--user-data-dir=${prof}`, 'about:blank',
], { stdio: ['ignore', openSync(`${outDir}/chrome.out`, 'a'), openSync(`${outDir}/chrome.err`, 'a')] });
writeFileSync(`${outDir}/chrome.pid`, String(chrome.pid));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => done('killed by ' + sig));
for (const e of ['uncaughtException', 'unhandledRejection']) process.on(e, (x) => done('driver: ' + (x?.message ?? x)));

let ws = null;
// Chromium picks its own debugging port and names it in the profile (a port of ours could be another job's), and
// gets a minute: several starting at once on a loaded host have taken more than 10 s.
let exited = false; chrome.on('exit', () => { exited = true; });
for (let i = 0; i < 300 && !ws && !exited; i++) {
  await sleep(200);
  try { const [p, path] = readFileSync(`${prof}/DevToolsActivePort`, 'utf8').split('\n'); if (path) ws = `ws://127.0.0.1:${p}${path}`; } catch {}
}
if (!ws) done(exited ? 'chromium exited at its start' : 'chromium did not start in 60 s');
const cdp = await Cdp.connect(ws);
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
const lim = (pr, what, ms = 20000) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + what)), ms))]);
const s = (m, p) => lim(cdp.send(m, p, sessionId), m, m === 'Page.navigate' ? 300000 : 30000);
// An evaluate the page does not answer in 10 s, or one that throws, is said in console.txt with what it was: a
// renderer that has gone quiet shows here first.
const ev = async (x) => {
  let r;
  try { r = await lim(cdp.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId), 'Runtime.evaluate (10 s)', 10000); }
  catch (e) { line(`[sweep] evaluate failed: ${e?.message ?? e} (${x.replace(/\s+/g, ' ').slice(0, 100)})`); throw e; }
  if (r?.exceptionDetails) line(`[sweep] evaluate threw: ${(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? '').split('\n')[0].slice(0, 200)} (${x.replace(/\s+/g, ' ').slice(0, 100)})`);
  return r?.result?.value;
};

// the page's and its Workers' consoles; the error lines a row's first_error comes from
const errs = [];
let phase = 'boot';
const ERR = /threw|RuntimeError|unreachable|trap|gex-console-error|\berr:|wine: |Unhandled exception|page fault|abort|assert|not implemented|unimplemented function|Bad format|failed/i;
const QUIET = /memory reaches \d+ MiB for |\[sig\] pid \d+ takes a signal|\[wins\]|\[mem\]|\[sweep\]|\[drop\]|native wasm32 module for|fixme:|\[sig\] pid \d+ sends signal|no function-tier unit/;
const line = (t) => {
  appendFileSync(`${outDir}/console.txt`, stamp() + ' ' + t + '\n');
  if (t.startsWith('[gex] ')) gexLine(t);
  if (!QUIET.test(t) && ERR.test(t)) errs.push({ t: now(), phase, text: t.slice(0, 300) });
  if (t.startsWith('[drop] ')) drops.push(t);
  if (/needs 64-bit memory/.test(t)) notices.push({ t: now(), text: t.slice(0, 300) });
  if (/\bexec \S*wine\.m64 /.test(t)) m64Execs.push(now());
  // the page's crash cards (windemo logs each one it shows, [crash] with its program): every one goes in the result
  if (t.startsWith('[crash] ')) (res.crash_cards ??= []).push(`${now().toFixed(0)} s ${t.slice(8, 300)}`);
};
const notices = [], m64Execs = [];
const drops = [];
const workers = new Set();
const workerInfo = new Map();
// A stalled start (a process that said "loaded X" and then nothing, while the run waits): 15 s after a "[gex] loaded"
// line with no [gex] line since, every attached Worker paused (Debugger.pause) and its JS and wasm stack logged, twice,
// 2 s apart -- a spin's pc moves inside a loop, a stuck await has nothing running (the pause never lands). Three
// probes a run at most. Only with APPSWEEP_STUCK_PROBE=1: pausing a heavy program's Workers (Godot on the JIT)
// hung the page and crashed its renderer, which a tile's own run must not see.
const stuckProbeOn = process.env.APPSWEEP_STUCK_PROBE === '1';
let gexQuiet = null, probes = 0;
const gexLine = (t) => {
  clearTimeout(gexQuiet);
  gexQuiet = null;
  if (stuckProbeOn && /^\[gex\] loaded /.test(t) && probes < 3) gexQuiet = setTimeout(() => { probes++; stuckProbe(t).catch((e) => log(`stuck probe failed: ${e?.message ?? e}`)); }, 15000);
};
// APPSWEEP_PROBE_AT=S,S,...: the same probe at those seconds of the run, whatever the log says (where each Worker's
// process and thread is in a long busy stretch)
for (const at of (process.env.APPSWEEP_PROBE_AT ?? '').split(',').filter(Boolean)) {
  setTimeout(() => { probes++; stuckProbe(`timed probe at ${at} s`).catch((e) => log(`timed probe failed: ${e?.message ?? e}`)); }, Number(at) * 1000).unref();
}
const pausedAt = new Map();
cdp.on('Debugger.paused', (e, sid) => pausedAt.get(sid)?.(e));
const frameName = (f) => `${f.functionName || '(anonymous)'} ${String(f.url || '').replace(/^.*\//, '') || `script ${f.location?.scriptId}`}:${(f.location?.lineNumber ?? 0) + 1}:${(f.location?.columnNumber ?? 0) + 1}`;
async function stackOf(sid) {
  const got = new Promise((r) => { pausedAt.set(sid, r); setTimeout(() => r(null), 1500); });
  await lim(cdp.send('Debugger.enable', {}, sid), 'Debugger.enable', 20000);
  await lim(cdp.send('Debugger.pause', {}, sid), 'Debugger.pause', 5000);
  const e = await got;
  pausedAt.delete(sid);
  // While paused: which process and thread this Worker runs (worker.mjs `__gexWho`), and the source around the
  // top frame when it is JS (a Worker's bundled script has no name worth giving)
  let who = '', near = '';
  if (e) {
    const f = e.callFrames[0];
    const ev = (x) => lim(cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: f.callFrameId, expression: x, returnByValue: true, silent: true }, sid), 'evaluate', 3000).then((r) => r?.result?.value).catch(() => undefined);
    const w = await ev('JSON.stringify(globalThis.__gexWho?.() ?? null)');
    if (w && w !== 'null') who = ` ${w}`;
    if (!/^\$/.test(f.functionName || '')) {
      const src = await lim(cdp.send('Debugger.getScriptSource', { scriptId: f.location.scriptId }, sid), 'source', 5000).catch(() => null);
      const lines = String(src?.scriptSource ?? '').split('\n');
      const ln = lines[f.location.lineNumber] ?? '';
      const c = f.location.columnNumber ?? 0;
      if (ln) near = ` near: ${JSON.stringify(ln.slice(Math.max(0, c - 120), c + 80))}`;
    }
    e.who = who;
    e.near = near;
  }
  if (e) await cdp.send('Debugger.resume', {}, sid).catch(() => {});
  // (a pause that never landed is cancelled with the domain)
  await cdp.send('Debugger.disable', {}, sid).catch(() => {});
  return e ? [`${e.who ?? ''}${e.near ?? ''}`.trim() || '-', ...e.callFrames.slice(0, 14).map(frameName)] : null;
}
async function stuckProbe(last) {
  log(`stuck probe ${probes}: no [gex] line for 15 s since "${last.slice(0, 120)}": pausing each of ${workers.size} Workers`);
  for (const round of [1, 2]) {
    if (round === 2) await sleep(2000);
    for (const sid of [sessionId, ...workers]) {
      const w = sid === sessionId ? 'the page' : workerInfo.get(sid);
      let st;
      try { st = await stackOf(sid); } catch (e) { log(`stuck probe ${probes}.${round} ${w ?? sid}: ${e?.message ?? e}`); continue; }
      if (!st) { log(`stuck probe ${probes}.${round} ${w ?? sid}: idle (nothing running to pause in 1.5 s)`); continue; }
      log(`stuck probe ${probes}.${round} ${w ?? sid}: ${st.join(' < ')}`);
    }
  }
}
cdp.on('Target.attachedToTarget', (e) => {
  workers.add(e.sessionId);
  workerInfo.set(e.sessionId, `${e.targetInfo?.type ?? '?'} "${e.targetInfo?.title ?? ''}" ${e.targetInfo?.targetId?.slice(0, 8) ?? ''}`);
  cdp.send('Runtime.enable', {}, e.sessionId).catch(() => {});
  cdp.send('Network.enable', {}, e.sessionId).catch(() => {});
  cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, e.sessionId).catch(() => {});
  cdp.send('Runtime.runIfWaitingForDebugger', {}, e.sessionId).catch(() => {});
});
cdp.on('Runtime.consoleAPICalled', (e) => line(e.args.map((a) => a.value ?? a.description).join(' ')));
// A split unit's cold code fetched (a Worker's ranged read of a unit's cold.bin): each one is code the program waited
// for, logged with its range so a run can count them
// Every request's URL and Range, for tile_reload.cached's audit of the reload's fetches
const requests = [];
cdp.on('Network.requestWillBeSent', (e) => {
  if (requests.length < 200000) requests.push({ url: e.request?.url ?? '', range: e.request?.headers?.Range ?? e.request?.headers?.range ?? null });
  if (/\/cold\.bin/.test(e.request?.url ?? '')) line(`[sweep] cold fetch ${e.request.url.replace(/^.*\/units\//, '')} ${e.request.headers?.Range ?? e.request.headers?.range ?? 'whole'}`);
});
cdp.on('Runtime.exceptionThrown', (e) => line('threw ' + (e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text)));
cdp.on('Inspector.targetCrashed', () => { line('[sweep] RENDERER CRASHED'); res.notes.push('renderer crashed'); done(); });
// Any target's crash (a Worker's or the page's renderer), with Chromium's status and code: OOM shows as such
cdp.on('Target.targetCrashed', (e) => {
  line(`[sweep] TARGET CRASHED ${e.targetId}${e.targetId === targetId ? ' (the page)' : ''} status ${e.status} code ${e.errorCode}`);
  if (e.targetId === targetId) { res.notes.push(`renderer crashed (${e.status} ${e.errorCode})`); done(); }
});
cdp.on('Target.detachedFromTarget', (e) => { workers.delete(e.sessionId); if (e.sessionId === sessionId) line('[sweep] the page detached'); });
await cdp.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
// Every 10 s: the page's JS heap (performance.memory) and the resident memory of this browser's processes (its own
// profile's): the renderer's growth before a crash is in the log.
const rss = () => {
  const out = [];
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!cmd.includes(prof)) continue;
      const type = /--type=([a-z-]+)/.exec(cmd)?.[1] ?? 'browser';
      const kb = +(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0);
      out.push({ type, mb: Math.round(kb / 1024) });
    } catch {}
  }
  return out;
};
setInterval(async () => {
  let heap = '?';
  try { const m = await ev('(()=>{const m=performance.memory;return m?[m.usedJSHeapSize,m.totalJSHeapSize,m.jsHeapSizeLimit].map(v=>Math.round(v/1048576)).join("/"):null})()'); if (m) heap = m; } catch {}
  const r = rss();
  const by = {};
  for (const p of r) by[p.type] = (by[p.type] ?? 0) + p.mb;
  line(`[mem] page heap ${heap} MiB (used/total/limit); rss MiB ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}; renderer max ${Math.max(0, ...r.filter((p) => p.type === 'renderer').map((p) => p.mb))}`);
}, 10000).unref();
// APPSWEEP_CPU=1: every 5 s, the CPU this browser's threads (its own profile's processes) used since the last line,
// by process type and thread name, from /proc (not a sampled profile): what a slow stage spends its time on.
if (process.env.APPSWEEP_CPU === '1') {
  const HZ = 100;
  let last = new Map();
  const tick = () => {
    const now = new Map(), by = new Map(), tops = [];
    for (const pid of readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      let type;
      try {
        const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        if (!cmd.includes(prof)) continue;
        type = /--type=([a-z-]+)/.exec(cmd)?.[1] ?? 'browser';
        if (type === 'utility') type = /--utility-sub-type=([\w.]+)/.exec(cmd)?.[1]?.split('.').pop() ?? type;
      } catch { continue; }
      let tids = [];
      try { tids = readdirSync(`/proc/${pid}/task`); } catch { continue; }
      for (const tid of tids) {
        try {
          const st = readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf8');
          const r = st.lastIndexOf(')');
          const comm = st.slice(st.indexOf('(') + 1, r).replace(/[0-9]+$/, '#');
          const f = st.slice(r + 2).split(' ');
          const t = +f[11] + +f[12];
          now.set(tid, t);
          const d = t - (last.get(tid) ?? t);
          if (d > 0) tops.push([d, `${type}/${comm}:${tid}`]);
          if (d > 0) { const k = `${type}/${comm}`; const e = by.get(k) ?? [0, 0]; e[0] += d; e[1]++; by.set(k, e); }
        } catch {}
      }
    }
    last = now;
    const all = [...by.values()].reduce((a, e) => a + e[0], 0);
    if (all) line(`[cpu] ${phase} ${(all / HZ).toFixed(1)} s in 5 s: ${[...by].sort((a, b) => b[1][0] - a[1][0]).slice(0, 8).map(([k, e]) => `${k}${e[1] > 1 ? `x${e[1]}` : ''} ${(e[0] / HZ).toFixed(1)}`).join(', ')}; busiest threads ${tops.sort((a, b) => b[0] - a[0]).slice(0, 3).map(([d, k]) => `${k} ${(d / HZ).toFixed(1)}`).join(', ')}`);
  };
  tick();
  setInterval(tick, 5000).unref();
}
// APPSWEEP_DPR=R (with APPSWEEP_SCREEN's CSS size): the page at device pixel ratio R (a fractional one, as a
// laptop's 150%), by Emulation.setDeviceMetricsOverride
if (+process.env.APPSWEEP_DPR > 0) { const [w, h] = SCREEN.split(',').map(Number); await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: +process.env.APPSWEEP_DPR, mobile: false }); log(`device metrics ${w}x${h} CSS px at ${process.env.APPSWEEP_DPR}`); }
await s('Runtime.enable'); await s('Page.enable'); await s('Inspector.enable').catch(() => {});
await s('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await s('Page.navigate', { url });
// The program's terminal output (Wine's own debug channels, WINEDEBUG set in a cmd line) to OUTDIR/out.txt, read
// from the page every 2 s: the page shows none of it.
{ let had = 0, busy = false;
  setInterval(async () => {
    if (busy) return; busy = true;
    try { const t = await lim(ev(`(globalThis.__app?.state?.out ?? '').slice(${had}, ${had} + 4000000)`), 'out', 5000);
      if (t) { appendFileSync(`${outDir}/out.txt`, t); had += t.length; } } catch {}
    busy = false;
  }, 2000).unref();
}

// the compositor's windows: [{id, w, h, x, y, title}]
const wins = async () => {
  const d = await ev('(async()=>{const c=globalThis.__gexCompositor;return c?await c.describe({pixels:false}):null})()').catch((e) => { line(`[wins] probe failed: ${e?.message ?? e}`); return null; });
  // A HiDPI output lists device pixels (describe().scale per CSS pixel): the sweep works in CSS pixels.
  const k = d?.scale > 0 ? d.scale : 1, c = (v) => Math.round(+v / k);
  return (d?.list ?? []).map((l) => {
    const m = /^(\S+) .*? (\d+)x(\d+)@(-?\d+),(-?\d+) .*?"(.*)"$/.exec(l);
    return m ? { id: m[1], w: c(m[2]), h: c(m[3]), x: c(m[4]), y: c(m[5]), title: m[6] } : { id: l, title: '' };
  });
};
let lastList = '';
const watch = async () => { const l = (await wins()).map((w) => `${w.id} ${w.w}x${w.h}@${w.x},${w.y} "${w.title}"`).join('|'); if (l !== lastList) { lastList = l; line('[wins] ' + l); } };
// APPSWEEP_WATCH_MS: also watch the window list every so many ms (a window's appearance timed finer than the plan's steps)
if (+process.env.APPSWEEP_WATCH_MS > 0) { let busy = false; setInterval(async () => { if (busy) return; busy = true; try { await watch(); } catch {} busy = false; }, +process.env.APPSWEEP_WATCH_MS).unref(); }
const CRASH = /crash|error|exception|problem|fatal|not responding/i;
const DIALOG = /crash|error|warning|exception|fail|problem|cannot|unable|fatal|crash|not found|invalid|unsupported|not supported|requires/i;
const dialogs = new Map();
let bailed = null;
const crop = (sh, w, name) => {
  const x0 = Math.max(0, w.x), y0 = Math.max(0, w.y), cw = Math.min(sh.w - x0, w.w), ch = Math.min(sh.h - y0, w.h);
  if (cw <= 0 || ch <= 0) return;
  const b = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) sh.b.copy(b, y * cw * 4, ((y0 + y) * sh.w + x0) * 4, ((y0 + y) * sh.w + x0 + cw) * 4);
  writeFileSync(`${outDir}/${name}.png`, png(cw, ch, b));
};
// big: a window of more than 8x8 (a program's hidden 1x1 main window, as Delphi's before its first dialog, is not its window)
const waitWin = async (re, secs, not = null, big = false) => {
  const r = new RegExp(re);
  let ls = now();
  for (const end = now() + secs; now() < end;) {
    await watch();
    if (now() - ls > 60) { ls = now(); await shot('wait'); }
    const all = await wins();
    const w = all.find((x) => r.test(x.title) && (!not || !not.has(x.id)) && (r.test('RC0') || !CRASH.test(x.title)) && (!big || (x.w > 8 && x.h > 8)));
    if (w) return w;
    // an error box (a small window titled as one): its picture, and after 45 s of it the wait ends
    const e = all.find((x) => DIALOG.test(x.title) && x.w < 800 && x.h < 500);
    if (e) {
      if (!dialogs.has(e.id)) {
        dialogs.set(e.id, now()); const sh = await shot('dialog-' + dialogs.size); if (sh) crop(sh, e, 'dialog-' + dialogs.size + '-box'); log(`dialog "${e.title}" ${e.w}x${e.h}@${e.x},${e.y}`); res.dialog = res.dialog ?? `"${e.title}" box (dialog-${dialogs.size}-box.png)`;
        // plan.dismiss: [{in: title regex, alt: key}]: a box the plan expects (a bundled installer's crash it
        // cannot avoid) answered with its button's key, named in the notes, and the wait goes on
        const d = (plan.dismiss ?? []).find((x) => new RegExp(x.in).test(e.title));
        if (d) { await click(e.x + Math.floor(e.w / 2), e.y + 12); await sleep(500); if (d.alt) await alt(d.alt); else await key(d.key); res.notes.push(`dismissed "${e.title}" (dialog-${dialogs.size}-box.png) with ${d.alt ? 'Alt+' + d.alt : d.key}`); }
      }
      else if (now() - dialogs.get(e.id) > 45) { const sh = await shot('dialog-' + dialogs.size); if (sh) crop(sh, e, 'dialog-' + dialogs.size + '-box'); bailed = `an error box "${e.title}" (dialog-${dialogs.size}-box.png)`; return null; }
    }
    await sleep(500);
  }
  return null;
};
// the guest's screen (canvas pixels): 1300 x 713 in the default window, the canvas's own size once the desktop is up
let W = 1300, H = 713;
const canvasAt = async (cx, cy) => {
  const r = await ev("(() => { let b = null; for (const c of document.querySelectorAll('canvas')) { const q = c.getBoundingClientRect(); if (!b || q.width * q.height > b.w * b.h) b = { x: q.x, y: q.y, w: q.width, h: q.height }; } return b; })()");
  return r ? [r.x + cx * r.w / W, r.y + cy * r.h / H] : [cx, cy];
};
const click = async (cx, cy) => {
  const [x, y] = await canvasAt(cx, cy);
  await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }).catch(() => {});
  await sleep(100);
  await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }).catch(() => {});
  await sleep(150);
  await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }).catch(() => {});
  log(`click ${cx},${cy}`);
};
// a double click (a desktop icon's open), as a mouse gives one: two presses, the second with clickCount 2
const dblclick = async (cx, cy) => {
  const [x, y] = await canvasAt(cx, cy);
  await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }).catch(() => {});
  await sleep(100);
  for (const n of [1, 2]) {
    await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: n }).catch(() => {});
    await sleep(60);
    await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: n }).catch(() => {});
    await sleep(60);
  }
  log(`double click ${cx},${cy}`);
};
// US layout: every printable ASCII character, Shift pressed as a key (the guest tracks it from its own events)
const SH = { '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`' };
const PK = { '-': ['Minus', 189], '=': ['Equal', 187], '[': ['BracketLeft', 219], ']': ['BracketRight', 221], '\\': ['Backslash', 220], ';': ['Semicolon', 186], "'": ['Quote', 222], ',': ['Comma', 188], '.': ['Period', 190], '/': ['Slash', 191], '`': ['Backquote', 192], ' ': ['Space', 32] };
const kd = (type, key, code, vk, mods, text) => s('Input.dispatchKeyEvent', { type, key, code, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) }).catch(() => {});
const shift = (down) => kd(down ? 'keyDown' : 'keyUp', 'Shift', 'ShiftLeft', 16, down ? 8 : 0);
const type = async (text) => {
  for (const ch of text) {
    let base = ch, sh = false;
    if (/[A-Z]/.test(ch)) { base = ch.toLowerCase(); sh = true; } else if (SH[ch]) { base = SH[ch]; sh = true; }
    const [code, vk] = PK[base] ?? (/[a-z]/.test(base) ? ['Key' + base.toUpperCase(), base.toUpperCase().charCodeAt(0)] : ['Digit' + base, base.charCodeAt(0)]);
    if (sh) await shift(true);
    await kd('keyDown', ch, code, vk, sh ? 8 : 0, ch); await sleep(40);
    await kd('keyUp', ch, code, vk, sh ? 8 : 0); if (sh) await shift(false);
    await sleep(40);
  }
  log('type ' + JSON.stringify(text));
};
const NAMED = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, Home: 36, End: 35, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, ' ': 32 };
const key = async (k) => {
  const vk = NAMED[k] ?? 0, code = k === ' ' ? 'Space' : k;
  await kd('keyDown', k, code, vk, 0, k === 'Enter' ? '\r' : k === ' ' ? ' ' : undefined); await sleep(120); await kd('keyUp', k, code, vk, 0);
  log('key ' + k);
};
// Ctrl+ch (a letter, a digit or one of PK's): a program's hotkey (Ditto's Ctrl+` shows its clip list)
const ctrl = async (ch) => {
  const [code, vk] = PK[ch] ?? (/[a-z]/.test(ch) ? ['Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0)] : ['Digit' + ch, ch.charCodeAt(0)]);
  await kd('keyDown', 'Control', 'ControlLeft', 17, 2); await sleep(60);
  await kd('keyDown', ch, code, vk, 2); await sleep(100); await kd('keyUp', ch, code, vk, 2);
  await sleep(60); await kd('keyUp', 'Control', 'ControlLeft', 17, 0);
  log('ctrl+' + ch);
};
const alt = async (ch) => {
  const vk = ch.toUpperCase().charCodeAt(0), code = 'Key' + ch.toUpperCase();
  await kd('keyDown', 'Alt', 'AltLeft', 18, 1); await sleep(60);
  await kd('keyDown', ch, code, vk, 1); await sleep(100); await kd('keyUp', ch, code, vk, 1);
  await sleep(60); await kd('keyUp', 'Alt', 'AltLeft', 18, 0);
  log('alt+' + ch);
};
const READOUT = `(async()=>{const c=globalThis.__gexCompositor;return c?.readoutBase64?await c.readoutBase64():null;})()`;
let lastShot = null;
const shot = async (name, page = false) => {
  const r = page ? null : await ev(READOUT).catch(() => null);
  if (r?.b64) { const b = Buffer.from(r.b64, 'base64'); writeFileSync(`${outDir}/${name}.png`, png(r.w, r.h, b)); lastShot = { w: r.w, h: r.h, b }; log('shot ' + name); return lastShot; }
  const p = await s('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (p) writeFileSync(`${outDir}/${name}.png`, Buffer.from(p.data, 'base64'));
  log('shot ' + name + ' (page)'); return null;
};
// how many pixels in rect w differ between two readouts
const diff = (a, b, w) => {
  if (!a || !b || a.w !== b.w) return -1;
  let n = 0;
  for (let y = Math.max(0, w.y); y < Math.min(a.h, w.y + w.h); y++) for (let x = Math.max(0, w.x); x < Math.min(a.w, w.x + w.w); x++) {
    const i = (y * a.w + x) * 4; if (a.b[i] !== b.b[i] || a.b[i + 1] !== b.b[i + 1] || a.b[i + 2] !== b.b[i + 2]) n++;
  }
  return n;
};
const firstErr = (from) => errs.find((e) => e.t >= from)?.text ?? null;
// cmd: the boot's console window, brought forward by a click on a point of it no other window covers (the
// compositor's own hit test), then a line typed and Enter. Covered all over (an installer opened a window on
// top of it): its taskbar button first.
let cmdWin = null;
const hit = (x, y) => ev(`(async()=>(await globalThis.__gexCompositor?.windowAt?.(${x},${y}))?.key??null)()`).catch(() => null);
// A fresh cmd window from the guest's agent (agent/agent.c, in the session since the page starts it): a job
// dropped into its queue runs `start "sweep-cmd" cmd.exe ...`, a new console on top of what covered the old one.
// null when the page or session has no agent (a site recorded before it was in the session).
const freshCmd = async () => {
  const id = `sweepcmd-${Date.now().toString(36)}`;
  const job = [`id=${id}`, 'name=cmd', 'check=C:\\windows\\system32\\cmd.exe',
    'launch=start "sweep-cmd" cmd.exe /v:on /k cd /d %USERPROFILE%\\Desktop'].join('\r\n') + '\r\n';
  const agent = (await wins()).some((x) => /^windemo-job /.test(x.title)) || await ev('!!globalThis.__windemoAgent').catch(() => false);
  const before = new Set((await wins()).map((x) => x.id));
  const ok = await ev(`(async () => { const a = globalThis.__app; if (!a?.drop) return false;
    await a.drop([new File([${JSON.stringify(job)}], '${id}.job')], { dir: '/pfx/drive_c/windemo/queue' }); return true; })()`).catch(() => false);
  if (!ok) return null;
  const w = await waitWin('^sweep-cmd', agent ? 60 : 20, before);
  log(`a fresh cmd from the agent: ${w ? `${w.w}x${w.h} at ${w.x},${w.y}` : 'none (no agent in the session?)'}`);
  return w;
};
// the console's taskbar button: the first after Start, the console being the first window the boot opens
const cmdButton = async () => {
  const bar = (await wins()).find((x) => x.w >= 400 && x.h <= 40 && x.y > 0 && !x.title);
  if (bar) { await click(bar.x + 160, bar.y + Math.floor(bar.h / 2)); await sleep(700); }
  return !!bar;
};
// a point on the screen: a minimised window sits at its iconic place far off it (-32000,-32000), where a click
// reaches nothing, so only points on the guest's W x H screen are hit-tested or clicked
const onScreen = async (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const cmd = async (text) => {
  // no console yet (a tile's desktop has none): a fresh one from the agent
  if (!cmdWin) { cmdWin = await freshCmd(); if (!cmdWin) { log('cmd: no console, and the agent opened none'); return; } await sleep(1500); }
  let w = (await wins()).find((x) => x.id === cmdWin.id) ?? cmdWin;
  const own = (k) => typeof k === 'string' && k.split(':')[0] === String(w.id).split(':')[0];
  if (!(await onScreen(w.x + Math.min(300, w.w / 2), w.y + Math.min(200, w.h / 2)))) {
    // minimised (minCmd) or moved off: restored from its taskbar button first, then found where it now is
    await cmdButton();
    w = (await wins()).find((x) => x.id === w.id) ?? w;
    log(`cmd window off-screen: its taskbar button clicked, now ${w.w}x${w.h} at ${w.x},${w.y}`);
  }
  let at = null;
  const pts = [[Math.min(300, w.w / 2), Math.min(200, w.h / 2)], ...[[0.25, 0.3], [0.75, 0.3], [0.25, 0.8], [0.75, 0.8], [0.5, 0.97], [0.95, 0.5], [0.5, 0.02]].map(([fx, fy]) => [w.w * fx, w.h * fy])];
  for (const [dx, dy] of pts) {
    const x = Math.round(w.x + dx), y = Math.round(w.y + dy);
    if (await onScreen(x, y) && own(await hit(x, y))) { at = [x, y]; break; }
  }
  if (!at) {
    // covered: a fresh cmd from the agent, when it is on top (the old one stays where it is)
    const f = await freshCmd();
    if (f) {
      const fx = Math.round(f.x + Math.min(300, f.w / 2)), fy = Math.round(f.y + Math.min(200, f.h / 2));
      const fk = await hit(fx, fy);
      if (typeof fk === 'string' && fk.split(':')[0] === String(f.id).split(':')[0]) { cmdWin = f; w = f; at = [fx, fy]; log('cmd window covered: the fresh one is used'); }
    }
  }
  if (at) await click(...at);
  else {
    await cmdButton();
    w = (await wins()).find((x) => x.id === w.id) ?? w;
    const x = Math.round(w.x + Math.min(300, w.w / 2)), y = Math.round(w.y + Math.min(200, w.h / 2));
    const up = await onScreen(x, y) && own(await hit(x, y));
    log(`cmd window covered: its taskbar button clicked, ${up ? 'now on top' : 'still covered'}`);
    if (up) await click(x, y);
    await sleep(700); await shot('cmd-raised');
  }
  await sleep(700);
  // Esc first: what an earlier line left half typed (a window that took the keyboard in the middle of it) goes
  await key('Escape'); await sleep(200);
  await type(text); await sleep(200); await key('Enter');
};
// The driver's console out of the way once it has started the program, so the shots show the program and
// the taskbar a visitor would have (its minimise box, the caption's third button from the right; cmd() raises
// it again from its taskbar button when it next types).
const minCmd = async () => {
  await sleep(500);
  const w = (await wins()).find((x) => x.id === cmdWin?.id);
  if (!w || w.w < 120) return;
  await click(w.x + w.w - 49, w.y + 13); await sleep(500);
  const still = (await wins()).find((x) => x.id === w.id);
  log(`cmd minimised: ${still && still.w === w.w && still.y === w.y ? 'still up' : 'yes'}`);
};
const run = async (steps) => {
  for (const st of steps ?? []) {
    if (st.wait) { const t0 = now(), w = await waitWin(st.wait, st.t ?? 120); if (!w) return `no window /${st.wait}/ in ${st.t ?? 120} s`; log(`/${st.wait}/ up in ${(now() - t0).toFixed(1)} s`); await sleep(1500); }
    else if (st.gone) { const r = new RegExp(st.gone); let gone = false; for (const end = now() + (st.t ?? 600); now() < end && !gone;) { await watch(); gone = !(await wins()).some((x) => r.test(x.title)); if (!gone) await sleep(1000); } if (!gone) return `/${st.gone}/ still open after ${st.t ?? 600} s`; }
    else if (st.press) {
      // st.press (a key) every st.every s (default 6), st.alt first when given, until no window matches
      // st.until (an installer's pages), st.t s at most; a shot press-N before each of the first 30
      const r = new RegExp(st.until); let n = 0;
      for (const end = now() + (st.t ?? 900); ; n++) {
        await watch();
        // (gone twice, 5 s apart: one installer window closing before its next opens is not the end)
        if (!(await wins()).some((x) => r.test(x.title))) { await sleep(5000); if (!(await wins()).some((x) => r.test(x.title))) break; }
        if (now() >= end) return `/${st.until}/ still open after ${st.t ?? 900} s (${n} presses)`;
        if (n < 30) await shot(`press-${n}`);
        if (st.alt) await alt(st.alt);
        await key(st.press);
        await sleep((st.every ?? 6) * 1000);
      }
      log(`${st.press}: /${st.until}/ gone after ${n} presses`);
    }
    // st.put (a host file, relative to where appsweep runs: runT.sh runs it in the plan folder) into the guest folder st.dir, through the page's drop
    else if (st.put) {
      const b64 = readFileSync(st.put).toString('base64'), name = basename(st.put);
      const ok = await ev(`(async () => { const a = globalThis.__app; if (!a?.drop) return 'no __app.drop';
        const b = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
        await a.drop([new File([b], ${JSON.stringify(name)})], { dir: ${JSON.stringify(st.dir)} }); return 'ok'; })()`).catch((e) => String(e));
      log(`put ${name} into ${st.dir}: ${ok}`); await sleep(2000);
    }
    // st.js: an expression evaluated in the page, its value logged (the page's own state: its crash cards)
    else if (st.js) { const v = await ev(st.js).catch((e) => 'error ' + e.message); log(`js ${st.js.slice(0, 60)}: ${JSON.stringify(v)}`); }
    else if (st.cmd) await cmd(st.cmd);
    else if (st.key) await key(st.key);
    else if (st.alt) await alt(st.alt);
    else if (st.ctrl) await ctrl(st.ctrl);
    else if (st.tap) { const vk = { Alt: 18, Control: 17, Shift: 16 }[st.tap]; const code = st.tap + 'Left'; await kd('keyDown', st.tap, code, vk, 0); await sleep(120); await kd('keyUp', st.tap, code, vk, 0); log('tap ' + st.tap); }
    else if (st.type) await type(st.type);
    else if (st.click && st.in) { const r = new RegExp(st.in); const w = (await wins()).find((x) => r.test(x.title)); if (!w) return `no window /${st.in}/ to click in`; await click(w.x + st.click[0], w.y + st.click[1]); }
    else if (st.click) await click(...st.click);
    else if (st.dbl) await dblclick(...st.dbl);
    // the driver's console minimised (out of a desktop icon's way)
    else if (st.mincmd) await minCmd();
    // the page reloaded as a visitor reloads it, then its desktop and launcher back
    else if (st.reload) {
      await s('Page.reload', { ignoreCache: false }).catch((e) => log('reload: ' + e.message));
      cmdWin = null;
      const t0 = now();
      if (!(await waitWin(' - Wine Desktop$', 300))) return 'no desktop in 300 s after the reload';
      for (let i = 0; i < 120; i++) { if (await ev("!!document.querySelector('#launcher .tile')").catch(() => false)) break; await sleep(1000); }
      log(`reloaded: desktop in ${(now() - t0).toFixed(1)} s`);
    }
    // a launcher tile by its name (the Desktop tile: the desktop as a visitor opens it after a reload)
    else if (st.tile) { const ok = await ev(`(() => { const b = [...document.querySelectorAll('#launcher .tile')].find((b) => b.querySelector('.name')?.textContent === ${JSON.stringify(st.tile)}); if (!b) return false; b.click(); return true; })()`).catch(() => false); log(`tile ${st.tile}: ${ok}`); if (!ok) return `no tile ${st.tile}`; }
    else if (st.sleep) await sleep(st.sleep * 1000);
    else if (st.shot) await shot(st.shot, st.page);
    await sleep(st.pause ?? 400);
  }
  return null;
};

// The renderer's VmData (MiB, its processes summed): what the page's memory costs the tab
const vmData = () => {
  try {
    const pids = execSync(`pgrep -f -- 'user-data-dir=${prof}' || true`).toString().trim().split(/\s+/).filter(Boolean);
    let kb = 0;
    for (const p of pids) {
      try { const st = readFileSync(`/proc/${p}/status`, 'utf8'); if (!/--type=renderer/.test(readFileSync(`/proc/${p}/cmdline`, 'utf8').replace(/\0/g, ' '))) continue; kb += Number(/VmData:\s+(\d+)/.exec(st)?.[1] ?? 0); } catch {}
    }
    return Math.round(kb / 1024);
  } catch { return null; }
};
// plan.restarts (the memory64 fallback): the first start may fall short with gex's notice that the program
// needs 64-bit memory, and the next start gets it. Each start's outcome (its window or the notice), seconds to
// it, whether its process ran on wine.m64 and the renderer's VmData go to res.starts; the program is started
// plan.restarts times more after the first, and with plan.reload once more after a reload of the page (the
// record of which programs need 64-bit memory outlives it). The usual check then runs on the last start's window.
// One start's outcome, from `from`: the program's window or gex's notice (res.starts)
async function startOne(appRe, seen, k, from) {
  res.starts ??= [];
  {
    const r = new RegExp(appRe);
    for (const end = from + (plan.timeout?.launch ?? 900); now() < end;) {
      await watch();
      const w = (await wins()).find((x) => r.test(x.title) && !seen.has(x.id) && !CRASH.test(x.title) && x.w > 8 && x.h > 8);
      const n = notices.find((x) => x.t >= from);
      if (w || n) {
        const st = { start: k, outcome: w ? 'window' : 'notice', secs: +(now() - from).toFixed(1), m64: m64Execs.some((x) => x >= from), vmdata_mib: vmData() };
        if (w) st.window = `${w.w}x${w.h} "${w.title}"`; if (n) st.notice = n.text;
        res.starts.push(st); log(`start ${k}: ${JSON.stringify(st)}`); await shot(`start-${k}`);
        return st;
      }
      await sleep(1000);
    }
    const st = { start: k, outcome: 'nothing', secs: +(now() - from).toFixed(1), m64: m64Execs.some((x) => x >= from), vmdata_mib: vmData() };
    res.starts.push(st); await shot(`start-${k}`); return st;
  }
}
// The program started again (the plan's launch line)
async function startAgain(appRe, seen, k) {
  // a window the last start left (the program up) is closed by its process first: taskkill on its image
  if (plan.image) { await cmd(`taskkill /f /im ${plan.image} >nul 2>&1 & title killed`); await waitWin('^killed$', 60); await sleep(5000); }
  for (const w of await wins()) seen.add(w.id);
  const t = now(); await cmd(`title launching & ${plan.launch}`); await minCmd();
  return startOne(appRe, seen, k, t);
}
// Any start that ends on gex's notice gets one more, however many came before (a visitor starts it again, and
// that start gets 64-bit memory), up to this many starts in all
const MAX_STARTS = 5;
async function restarts(appRe, t0, seen) {
  const one = (k, from) => startOne(appRe, seen, k, from), again = (k) => startAgain(appRe, seen, k);
  let last = await one(1, t0), k = 1;
  while (k < 1 + (plan.restarts ?? 0) || (last.outcome === 'notice' && k < MAX_STARTS)) last = await again(++k);
  const pre = last;
  if (plan.reload) {
    phase = 'reload';
    await s('Page.reload', { ignoreCache: false }).catch((e) => log('reload: ' + e.message));
    const tr = now();
    cmdWin = await waitWin('cmd\\.exe$', 300);
    if (!cmdWin || !(await waitWin('^Desktop$', 60))) { res.first_error = 'the desktop did not come up again after the reload'; done(); }
    res.times.reload_desktop = +(now() - tr).toFixed(1);
    await sleep(3000);
    const fm = (await wins()).find((w) => w.title === 'Desktop');
    if (fm) { await click(fm.x + fm.w - 14, fm.y + 15); await sleep(1500); }
    if (plan.check) { await cmd(`if exist "${plan.check}" (title HAVE) else (title NOFILE)`); const c = await waitWin('^(HAVE|NOFILE)$', 60); res.notes.push(`after the reload: ${c?.title === 'HAVE' ? 'still installed' : 'not installed any more'}`); if (c?.title !== 'HAVE') done(); }
    for (const w of await wins()) seen.add(w.id);
    const t = now(); await cmd(`title launching & ${plan.launch}`); await minCmd();
    last = await one(++k, t);
    while (last.outcome === 'notice' && k < MAX_STARTS) last = await again(++k);
  }
  // the memory64 restart's window is the launch: a start after the reload that maps none is a note, and the
  // program is not there for the usable check
  if (last !== pre && last.outcome !== 'window' && pre.outcome === 'window') {
    res.notes.push(`the start after the page reload: ${last.outcome === 'notice' ? last.notice : `no window in ${last.secs} s`}`);
    res.launch = 'ok'; res.window = pre.window; res.times.launch = pre.secs; res.usable = 'not checked (no window after the reload)'; done();
  }
  if (last.outcome !== 'window') { res.launch = last.outcome === 'notice' ? 'notice' : 'fail'; res.first_error = last.notice ?? `no window in ${plan.timeout?.launch ?? 900} s`; done(); }
}

// 0. a tile's flow: its click on the launcher (a bring-your-own tile: its installer into the dialog's input)
const isBase = (w) => /cmd\.exe$|^Desktop$| - Wine Desktop$|^launching ?$/.test(w.title) || !w.title;
// an installer's own window (its title names the program too: "foobar2000 v2.1.6 (x64) Setup"), and the agent's job windows
// (a console window, titled with its program's path, is not the program's window either: Blender's MSI runs blender.exe in one)
const isSetup = (w) => /setup|install|wizard|licen[cs]e agreement|^windemo-job |\.exe$/i.test(w.title);
if (plan.tile) {
  let have = false;
  for (let i = 0; i < 120 && !have; i++) { have = await ev("!!document.querySelector('#launcher .tile')").catch(() => false); if (!have) await sleep(1000); }
  const clicked = have && await ev(`(() => { const b = [...document.querySelectorAll('#launcher .tile')].find((b) => b.querySelector('.name')?.textContent === ${JSON.stringify(plan.tile)}); if (!b) return false; b.click(); return true; })()`);
  log(`tile ${JSON.stringify(plan.tile)}: ${clicked ? 'clicked' : 'not found'}`);
  if (!clicked) { res.first_error = `no tile ${plan.tile}`; done(); }
  res.times.tile = +now().toFixed(1);
  if (plan.bring) {
    await sleep(1000);
    const { root } = await s('DOM.getDocument', { depth: 0 });
    const { nodeId } = await s('DOM.querySelector', { nodeId: root.nodeId, selector: '#byo input[type=file]' });
    await s('DOM.setFileInputFiles', { nodeId, files: [plan.bring] });
    log('brought ' + plan.bring.replace(/^.*\//, ''));
  }
}

// 1. boot: the desktop and its cmd window
// (a tile's desktop has no cmd window and no file manager: Wine's desktop window is the boot)
cmdWin = plan.tile ? null : await waitWin('cmd\\.exe$', 300);
if (plan.tile && !(await waitWin(' - Wine Desktop$', 300))) { res.first_error = firstErr(0) ?? 'the desktop did not come up in 300 s'; await shot('boot'); done('boot failed'); }
// The windows there before the install: a timeout notes the others by title (a box's title says what stopped
// it, as Blender's "Unsupported CPU" did; its picture is the dialog-N-box.png the error-box wait crops).
const startWins = new Set((await wins()).map((w) => w.id));
const newWins = async () => { const t = (await wins()).filter((w) => !startWins.has(w.id) && w.title).map((w) => `"${w.title}" ${w.w}x${w.h}`); if (t.length) res.notes.push('windows at the timeout: ' + t.join(', ')); };
if (!plan.tile && (!cmdWin || !(await waitWin('^Desktop$', 60)))) { res.first_error = firstErr(0) ?? 'the desktop did not come up in 300 s'; await shot('boot'); done('boot failed'); }
res.times.desktop = Math.round(now());
{ const c = await ev("(() => { let b = null; for (const c of document.querySelectorAll('canvas')) if (!b || c.width * c.height > b[0] * b[1]) b = [c.width, c.height]; return b; })()").catch(() => null); if (c?.[0] > 0) { [W, H] = c; log(`screen ${W}x${H}`); } }
// APPSWEEP_OPENED=1: the files the install opens beyond the boot's, in the order they were first opened
// (the page's __ntOpened), into OUTDIR/opened-install.txt: a site's rest-bundle order (eject-site
// --rest-order) from the sweep's own runs.
const opened = async () => { try { const r = await ev('(async () => await globalThis.__ntOpened?.())()'); return Array.isArray(r) ? r.map(String) : null; } catch { return null; } };
const bootOpened = process.env.APPSWEEP_OPENED ? await opened() : null;
const saveOpened = async () => {
  if (!bootOpened) return;
  const now_ = await opened();
  if (!now_) return;
  const boot = new Set(bootOpened);
  const fresh = now_.filter((p) => !boot.has(p));
  writeFileSync(`${outDir}/opened-install.txt`, fresh.join('\n') + (fresh.length ? '\n' : ''));
  log(`opened by the install: ${fresh.length} files`);
};
await sleep(3000);
const deskList = await wins(), desk = await shot('desktop');
// the file manager opens over cmd: close it (its title bar's close box), so a click on cmd reaches cmd
const fm = (await wins()).find((w) => w.title === 'Desktop');
if (fm) { await click(fm.x + fm.w - 14, fm.y + 15); await sleep(1500); }

// a tile's install: its installer's windows, each one's default button, until the program's window is up
let t2 = now();
if (plan.tile) {
  phase = 'install';
  t2 = now(); const r = new RegExp(plan.title ?? '.');
  let presses = 0, up = false, quiet = 0, asked = 0, again = false, instRan = false;
  const CONFIRM = /^exit setup$|cancel|abort|^confirm/i;
  // Whose a window is, by process (its id is pid:client:surface), not by title: the processes with windows
  // while the agent's job is downloading or in its installer are the installer's; once the job has started
  // the program, a window of any other process is the program's (its first-start dialogs), answered only by
  // the plan's answers, never pressed through as an installer page.
  const instPids = new Set();
  const pidOf = (w) => String(w.id).split(':')[0];
  for (const end = now() + (plan.timeout?.install ?? 1500); !up;) {
    await watch();
    const l = await wins();
    const job = l.map((w) => /^windemo-job \S+ (\S+)/.exec(w.title)?.[1]).find(Boolean) ?? null;
    if (job === 'downloading' || job === 'installer') for (const w of l) if (!isBase(w) && !/^windemo-/.test(w.title)) instPids.add(pidOf(w));
    const programs = job === 'started' || job === 'exited';
    up = l.some((w) => !isBase(w) && !isSetup(w) && r.test(w.title) && w.w > 8 && w.h > 8);
    if (up) break;
    if (now() >= end) { await shot('install-timeout'); await newWins();
      // plan.timeout_js: expressions read out at the timeout (a debug dump of what every thread waits in)
      for (const x of plan.timeout_js ?? []) log(`timeout js ${x}: ${JSON.stringify(await ev(x).catch((e) => String(e?.message ?? e)))}`); res.install = 'timeout'; res.first_error = firstErr(t2) ?? `no ${plan.title} window in ${plan.timeout?.install ?? 1500} s (${presses} presses)`; done(); }
    // the loading screen's failure box (the desktop exited, the job failed): the row ends on its words
    const box = await ev("(() => { const b = document.querySelector('#loading .why.on'); return b ? b.innerText.replace(/\\s+/g, ' ') : null; })()").catch(() => null);
    if (box) { await shot('page-failed'); res.install = 'page: ' + box; res.first_error = firstErr(t2) ?? box; done(); }
    // the program's first start ended on gex's 64-bit memory notice: its tile clicked again, as a visitor would
    if (!again && notices.some((x) => x.t >= t2)) {
      again = true; res.notes.push('the first start ended on the 64-bit memory notice: the tile clicked again'); await sleep(8000);
      const ok = await ev(`(() => { const b = [...document.querySelectorAll('#launcher .tile')].find((b) => b.querySelector('.name')?.textContent === ${JSON.stringify(plan.tile)}); if (!b) return false; b.click(); return true; })()`).catch(() => false);
      log(`tile clicked again: ${ok}`); res.times.again = +(now() - t2).toFixed(1);
    }
    // (a progress window, titled with its percentage, is left alone: Enter there is its Cancel, as in 7-Zip's extraction)
    const big = l.filter((w) => !isBase(w) && w.w >= 200 && w.h >= 100 && !/^\d+% /.test(w.title));
    const inst = programs ? big.filter((w) => instPids.has(pidOf(w))) : big;
    // the program's own dialogs before its main window: the plan's answer, if it has one, and nothing else
    for (const w of programs ? big.filter((x) => !instPids.has(pidOf(x))) : []) {
      const ans = (plan.answers ?? []).find((a) => new RegExp(a.in).test(w.title));
      if (ans) { await click(w.x + ans.click[0], w.y + ans.click[1]); log(`program dialog "${w.title}" (pid ${pidOf(w)}): answered at ${ans.click}`); }
    }
    // plan.inst_steps: the installer's first window answered by these steps instead (a page whose default is
    // not the Enter key's: Python's "Install Now" link), once
    if (inst.length && plan.inst_steps && !instRan) { instRan = true; await shot('inst-steps'); const why = await run(plan.inst_steps); log(`installer steps${why ? ': ' + why : ''}`); }
    else if (inst.length) {
      const w = inst[inst.length - 1];
      if (presses < 40) await shot(`inst-${presses}`);
      await click(w.x + Math.floor(w.w / 2), w.y + 10); await sleep(300);
      // Enter on a page whose only button is Cancel (a copy in progress) asks whether to stop: No, and the
      // installer is left alone for a while (longer each time)
      // plan.answers: [{in: regex, click: [x, y] in that window}] a window's own answer (a question with no
      // default button: MuseScore's telemetry box), clicked instead of Enter
      const ans = (plan.answers ?? []).find((a) => new RegExp(a.in).test(w.title));
      if (ans) { await click(w.x + ans.click[0], w.y + ans.click[1]); log(`installer "${w.title}": answered at ${ans.click}`); }
      else if (CONFIRM.test(w.title)) { await alt('n'); quiet = now() + 15 * ++asked; log(`installer "${w.title}": No, quiet ${15 * asked} s`); }
      else if (now() >= quiet) {
        if (plan.accept !== false) { await alt('a'); await sleep(300); }
        await key('Enter'); presses++;
        log(`installer "${w.title}" ${w.w}x${w.h}: press ${presses}`);
      }
    }
    await sleep((plan.every ?? 6) * 1000);
  }
  res.drop = 'n/a'; res.install = 'ok (tile)'; res.times.install = Math.round(now() - t2);
  await saveOpened();
}

// 2. the installer dragged in from the host
phase = 'drop';
if (!plan.tile) {
const t1 = now();
const nDrop = drops.length;
const data = { items: [], files: plan.drop, dragOperationsMask: 1 };
for (const t of ['dragEnter', 'dragOver', 'drop']) { await s('Input.dispatchDragEvent', { type: t, x: 900, y: 400, data }).catch((e) => log('drag ' + t + ': ' + e.message)); await sleep(200); }
log('dropped ' + plan.drop.join(' '));
// every dropped file's size, a folder's files included (its own stat is a few KB)
const treeBytes = (p) => {
  try {
    const st = statSync(p);
    return st.isDirectory() ? readdirSync(p).reduce((a, n) => a + treeBytes(join(p, n)), 0) : st.size;
  } catch { return 0; }
};
const bytes = plan.drop.reduce((a, p) => a + treeBytes(p), 0);
for (const end = now() + 60 + bytes / 2e6; now() < end && drops.length === nDrop;) await sleep(500);
if (drops.length === nDrop) { res.drop = 'fail'; res.first_error = firstErr(t1) ?? 'no [drop] report'; done(); }
res.drop = 'ok'; res.times.drop = +(now() - t1).toFixed(1);
// the drop's copy runs on after its report: give it the file's size at 20 MB/s
await sleep(2000 + bytes / 20e3);

// 3. install: cmd with delayed expansion, the exit status into cmd's title
phase = 'install';
t2 = now();
await cmd('cmd /v:on'); await sleep(1500);
await cmd('cd /d %USERPROFILE%\\Desktop'); await sleep(800);
const before = new Set((await wins()).map((w) => w.id));
if (plan.install) {
  await cmd(`${plan.install} & title RC!errorlevel!`);
  const w = await waitWin('^RC-?\\d+$', plan.timeout?.install ?? 900);
  await shot('installed');
  if (!w) { await newWins(); res.install = bailed ? 'error box' : 'timeout'; res.first_error = bailed ?? firstErr(t2) ?? `no exit in ${plan.timeout?.install ?? 900} s`; done(); }
  const rc = Number(w.title.slice(2));
  res.install = (plan.okrc ?? [0, 3010, 1641]).includes(rc) ? 'ok' : `rc ${rc}`;
  res.times.install = Math.round(now() - t2);
  if (res.install !== 'ok') { res.first_error = firstErr(t2) ?? `installer exit status ${rc}`; done(); }
  if (plan.check) {
    // a file the install writes, or (cmd:...) a command that succeeds only after it (a registry value):
    // an installer's exit status alone passes one that installed nothing ("already installed")
    const check = plan.check.startsWith('cmd:') ? `(${plan.check.slice(4)}) >nul 2>&1 && (title HAVE) || (title NOFILE)` : `if exist "${plan.check}" (title HAVE) else (title NOFILE)`;
    await cmd(check);
    let c = await waitWin('^(HAVE|NOFILE)$', 60);
    // No answer at all: the line went elsewhere (an installer's child, still exiting, took the focus;
    // WinRAR's uninstall.exe /setup), not a missing file. Typed once more.
    if (!c) { res.notes.push('the check had no answer: typed again'); await cmd(check); c = await waitWin('^(HAVE|NOFILE)$', 60); }
    if (c?.title !== 'HAVE') {
      // the x64 Program Files mix-up (the CPU seen as x86): the files under C:\Files or C:\System64
      await cmd('if exist "C:\\Files\\*" (title CFILES) else if exist "C:\\System64\\*" (title CSYS64) else (title NOWHERE)');
      const d = await waitWin('^(CFILES|CSYS64|NOWHERE)$', 60);
      if (d && d.title !== 'NOWHERE') res.wrong_dir = d.title === 'CFILES' ? 'C:\\Files' : 'C:\\System64';
    }
    if (c?.title !== 'HAVE') { res.install = 'no ' + plan.check + (res.wrong_dir ? ` (installed under ${res.wrong_dir})` : ''); res.first_error = firstErr(t2) ?? `the installer finished (rc ${rc}) without writing ${plan.check}`; done(); }
  }
} else if (plan.interactive) {
  await cmd(plan.start ?? '');
  const why = await run(plan.interactive);
  await shot('installed');
  if (why) { res.install = 'fail'; res.first_error = firstErr(t2) ?? why; done(); }
  res.install = 'ok (interactive)'; res.times.install = Math.round(now() - t2);
} else res.install = 'n/a';
} // not a tile

// 4. launch the installed program: a new window
phase = 'launch';
if (!plan.launch && !plan.tile) done();
const t3 = now();
let seen = new Set((await wins()).map((w) => w.id));
// An installer's last page may start the program itself (a "Run ..." box, checked): a window of the
// program's (plan.title) that the install opened, within 20 s of it ending, is that start, and the program
// is not started a second time (a second copy can find the first one's settings file in use)
let started = false;
if (plan.title) {
  const r = new RegExp(plan.title);
  for (const end = now() + 20; now() < end && !started;) {
    started = (await wins()).some((w) => !startWins.has(w.id) && r.test(w.title));
    if (!started) await sleep(1000);
  }
  if (started) { log('the install started the program'); seen = startWins; }
}
if (plan.tile) { started = true; seen = new Set((await wins()).filter((w) => !new RegExp(plan.title ?? '.').test(w.title) || isBase(w) || isSetup(w)).map((w) => w.id)); }
if (!started) { await cmd(`title launching & ${plan.launch}`); await minCmd(); }
// the program's own dialog on the way to its window (OBS's "Wine detected": Launch Anyway), answered as the plan says
if (plan.launch_steps) { const why = await run(plan.launch_steps); if (why) res.notes.push('launch steps: ' + why); }
const appRe = plan.title ?? '^(?!launching$|RC-?\\d+$|Desktop$|$).+';
// Any row: a first start that ends on gex's notice that the program needs 64-bit memory (the crash notice, recorded)
// is started again, as a visitor would, and that start gets it; as a plan's restarts, with one.
if (!plan.restarts) {
  const r = new RegExp(appRe);
  for (const end = now() + (plan.timeout?.launch ?? 180); now() < end;) {
    if (notices.some((x) => x.t >= t3)) { res.notes.push('the first start ended on the 64-bit memory notice: started again'); plan.restarts = 1; break; }
    if ((await wins()).some((w) => !seen.has(w.id) && r.test(w.title) && w.w > 8 && w.h > 8)) break;
    await sleep(1000);
  }
}
if (plan.restarts) await restarts(appRe, t3, seen);
let app = await waitWin(appRe, plan.timeout?.launch ?? 180, seen, true);
if (!app) { await shot('launch'); await newWins(); res.launch = bailed ? 'error box' : 'fail'; res.first_error = bailed ?? firstErr(t3) ?? `no window in ${plan.timeout?.launch ?? 180} s`; done(); }
res.launch = 'ok'; res.times.launch = +(now() - t3).toFixed(1); res.window = app.title;
// settle_shots: a picture every that many seconds of the settle, named by the seconds since the window came
// (settle-90s), to tell from them when a slow program's own screen (a game's main menu) is up
if (plan.settle_shots) {
  const t5 = now(), step = plan.settle_shots * 1000;
  for (let k = 1; k * step <= (plan.settle ?? 6000); k++) { await sleep(Math.max(0, t5 * 1000 + k * step - now() * 1000)); await watch(); await shot(`settle-${Math.round(now() - t3 - res.times.launch)}s`); }
} else await sleep(plan.settle ?? 6000);
// A first window that closed in the settle (a splash) hands over to the program's next one of the same title,
// the largest that came since the launch
{
  const ws = await wins();
  if (!ws.some((w) => w.id === app.id)) {
    const r = new RegExp(appRe);
    const next = ws.filter((w) => !seen.has(w.id) && w.title && r.test(w.title)).sort((x, y) => y.w * y.h - x.w * x.h)[0];
    if (next) { res.notes.push(`its first window (${app.w}x${app.h} "${app.title}") closed; the next, ${next.w}x${next.h} "${next.title}", is used`); app = next; res.window = app.title; }
  }
}
const a = await shot('app');

// 5. one interaction: a click in the window's middle, then the plan's keys (default: a few letters, Enter)
phase = 'use';
const t4 = now();
const now4 = await wins();
const live = now4.find((w) => w.id === app.id) ?? app;
// Windows that came up beside the program's own (an updater's offer, a tip of the day) are left alone: the
// click goes to a point of the program's window none of them covers, so the keys after it go to the program
const others = now4.filter((w) => w.id !== app.id && !startWins.has(w.id) && w.title && w.w > 32 && w.h > 32
  && !(plan.title && new RegExp(plan.title).test(w.title)));
if (others.length) res.notes.push('other windows, left alone: ' + others.map((w) => `"${w.title}" ${w.w}x${w.h}`).join(', '));
// The window against the work area (the screen above the taskbar, an untitled full-width window at the bottom):
// inside it (8 px of frame may stand out, as a maximised window's does), its caption on screen (its top within it and
// 40 px of its width over the screen)
{
  const bar = now4.filter((w) => !w.title && w.w >= W - 8 && w.h < 80 && w.y + w.h >= H - 2).sort((p, q) => q.w - p.w)[0];
  const wa = { w: W, h: bar ? bar.y : H }, e = 8;
  const inside = live.x >= -e && live.y >= -e && live.x + live.w <= wa.w + e && live.y + live.h <= wa.h + e;
  const caption = live.y >= -e && live.y + 20 <= wa.h && live.x + live.w >= 40 && live.x <= wa.w - 40;
  res.fit = { window: `${live.w}x${live.h}@${live.x},${live.y}`, work_area: `${wa.w}x${wa.h}`, fits: inside, caption_on_screen: caption };
}
const covered = (x, y) => others.some((w) => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h);
const at = [[1, 2], [1, 4], [3, 4]].flatMap(([fy, dy]) => [[1, 2], [1, 4], [3, 4]].map(([fx, dx]) =>
  [live.x + Math.floor(live.w * fx / dx), live.y + Math.floor(live.h * fy / dy)]))
  .find(([x, y]) => !covered(x, y) && x < W && y < H);
if (others.length && !at) res.notes.push("every point tried in the program's window is covered");
await click(...(at ?? [live.x + Math.floor(live.w / 2), live.y + Math.floor(live.h / 2)]));
await sleep(800);
// the menu bar (Alt, Down) first; a window without one, typed into
const full = { x: 0, y: 0, w: W, h: H };
let why = await run(plan.use ?? [{ tap: 'Alt' }, { key: 'ArrowDown' }]);
await sleep(2500);
let b = await shot('used');
let changed = diff(a, b, full);
if (!plan.use && changed === 0) {
  await run([{ key: 'Escape' }, { key: 'Escape' }, { type: 'hello' }]);
  await sleep(2500); b = await shot('used2'); changed = diff(a, b, full);
}
await watch();
// (a program that destroys and re-creates its top-level window, as SuperTux on a GL renderer fallback, is still
// there: a new top-level of the same process and title is the same app, as the settle's handover takes it)
const pidOf = (id) => String(id).split(':')[0];
const nowWins = await wins();
let still = nowWins.some((w) => w.id === app.id);
if (!still) {
  const again = nowWins.filter((w) => pidOf(w.id) === pidOf(app.id) && w.title === app.title).sort((x, y) => y.w * y.h - x.w * x.h)[0];
  if (again) { still = true; res.notes.push(`its window was re-created (${again.w}x${again.h} "${again.title}", same process)`); }
}
// Drawn: the share of the program's window (on screen) whose pixels differ from the desktop as it was before
// anything ran, at its first picture; a window more than half undrawn, or one colour over 97% of it (a GL
// window still black or white), is not used, whatever changed after
const drawn = (() => {
  if (!desk || !a || desk.w !== a.w) return null;
  const x0 = Math.max(0, live.x), y0 = Math.max(0, live.y), x1 = Math.min(a.w, live.x + live.w), y1 = Math.min(a.h, live.y + live.h);
  // Only pixels where the desktop picture shows the bare desktop say whether the program drew: over another
  // window an unpainted one and a painted one can look the same (white over white). Too few such pixels: only the one-colour test.
  // (The desktop's own window, the whole screen, is the bare desktop, not a window over it.)
  const over = deskList.filter((w) => !(w.x <= 0 && w.y <= 0 && w.w >= W && w.h >= H));
  const under = (x, y) => over.some((w) => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h);
  let walls = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!under(x, y)) walls++;
  const wallOnly = walls >= ((x1 - x0) * (y1 - y0)) / 10;
  // (the colours' counts folded, not spread: a photo-like window has more colours than a call takes arguments)
  let n = 0, tot = 0, all = 0; const hist = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * a.w + x) * 4; all++;
    const c = (a.b[i] << 16) | (a.b[i + 1] << 8) | a.b[i + 2]; hist.set(c, (hist.get(c) ?? 0) + 1);
    if (wallOnly && under(x, y)) continue;
    tot++;
    if (Math.abs(a.b[i] - desk.b[i]) + Math.abs(a.b[i + 1] - desk.b[i + 1]) + Math.abs(a.b[i + 2] - desk.b[i + 2]) > 24) n++;
  }
  return tot ? { frac: wallOnly ? n / tot : 1, over: wallOnly ? tot / all : 0, top: [...hist.values()].reduce((m, v) => (v > m ? v : m), 0) / all } : null;
})();
if (drawn) res.notes.push(`drawn: ${Math.round(drawn.frac * 100)}% of its ${live.w}x${live.h} window, measured over the ${Math.round(drawn.over * 100)}% of it on the bare desktop in the desktop picture (most common colour ${Math.round(drawn.top * 100)}%)`);
const undrawn = drawn && (drawn.frac <= 0.5 || drawn.top > 0.97);
res.usable = !still ? 'window gone' : why ? why : undrawn ? `not drawn (${Math.round(drawn.frac * 100)}% of its window, ${Math.round(drawn.top * 100)}% one colour)` : changed === 0 ? 'no change' : 'ok';
res.changed_px = changed;
// The window gone on gex's notice in the interaction: that start ended on the notice too, so it is started
// again (as any start that ends on it), and the starts after it are recorded; the usable check stays this one's
if (!still && notices.some((x) => x.t >= t4)) {
  const n = notices.find((x) => x.t >= t4);
  res.notes.push(`the window went on the 64-bit memory notice in the interaction (${n.text}): started again`);
  if (!res.starts?.length) res.starts = [{ start: 1, outcome: 'window', secs: res.times.launch, window: `${app.w}x${app.h} "${app.title}"`, ended: 'notice in the interaction' }];
  let k = res.starts.length, last;
  do last = await startAgain(appRe, seen, ++k); while (last.outcome === 'notice' && k < MAX_STARTS);
  if (last.outcome === 'window') res.usable = `window gone on the 64-bit memory notice; start ${k}${last.m64 ? ' (memory64)' : ''}: ${last.window} in ${last.secs} s`;
}
if (res.usable !== 'ok') res.first_error = firstErr(t4) ?? res.usable;
res.err_lines = errs.filter((e) => e.t >= t2).length; res.first_err_line = firstErr(t2);
// any later plan steps (a second interaction to look at by eye)
if (plan.after) await run(plan.after);
// a tile's second start after a page reload (plan.tile_reload: {secs, after: [steps], settle: s}): the page reloaded, the tile clicked again
// (installed now: straight to the program), and the window list followed each second for that long, its changes
// logged ([wins]) with pictures every 30 s, to read the program's real window off (a splash has its title too)
// plan.tile_reload.cached: the reload must fetch nothing the page's Cache Storage held before it: no request for a URL
// it keeps, and no range of a bundle frame it keeps (site/lazy-source.mjs: frame K of BUNDLE under BUNDLE?h=H&f=K,
// BUNDLE.json's frames[K] its [offset, length]). res.cached: {held, refetched: [...]}; any refetch is the run's error.
const HELD = `(async () => { const out = []; for (const n of await caches.keys()) { const c = await caches.open(n); for (const r of await c.keys()) out.push(r.url); } return out; })()`;
async function cachedAudit(held, from) {
  const urls = new Set(), frames = new Map(); // bundle URL -> { h, ks: Set }
  for (const k of held) {
    const u = new URL(k), h = u.searchParams.get('h'), f = u.searchParams.get('f');
    if (h && f !== null && u.searchParams.size === 2) {
      u.search = '';
      const b = frames.get(u.href) ?? { h, ks: new Set() };
      if (b.h === h) b.ks.add(Number(f));
      frames.set(u.href, b);
    } else urls.add(k);
  }
  const offsets = new Map();
  for (const [b, { h }] of frames) {
    const ix = await ev(`fetch(${JSON.stringify(`${b}.json`)}).then((r) => r.json())`).catch(() => null);
    if (ix?.h === h) offsets.set(b, new Map(ix.frames.map(([o], k) => [o, k])));
  }
  const refetched = [];
  for (const r of requests.slice(from)) {
    const bare = r.url.replace(/#.*$/, '');
    if (urls.has(bare)) { refetched.push(bare); continue; }
    const b = frames.get(bare.replace(/\?.*$/, '')), lo = /^bytes=(\d+)-/.exec(r.range ?? '')?.[1];
    const k = b && lo !== undefined ? offsets.get(bare.replace(/\?.*$/, ''))?.get(Number(lo)) : undefined;
    if (k !== undefined && b.ks.has(k)) refetched.push(`${bare} frame ${k}`);
  }
  return { held: held.length, refetched };
}
if (plan.tile && plan.tile_reload) {
  phase = 'reload';
  const held = plan.tile_reload.cached ? ((await ev(HELD).catch(() => null)) ?? []) : null;
  const from = requests.length;
  await s('Page.reload', { ignoreCache: false }).catch((e) => log('reload: ' + e.message));
  const tr = now();
  if (!(await waitWin(' - Wine Desktop$', 300))) res.notes.push('after the reload: no desktop in 300 s');
  else {
    res.times.reload_desktop = +(now() - tr).toFixed(1);
    let have = false;
    for (let i = 0; i < 120 && !have; i++) { have = await ev("!!document.querySelector('#launcher .tile')").catch(() => false); if (!have) await sleep(1000); }
    // plan.tile_reload.open: the program's start as steps of its own instead of the tile's click (a desktop
    // icon's double click: {dbl: [x, y]}), the launcher out of the way first (Escape, as a visitor closes it)
    let ok;
    if (plan.tile_reload.open) { ok = (await run(plan.tile_reload.open)) ?? true; }
    else ok = await ev(`(() => { const b = [...document.querySelectorAll('#launcher .tile')].find((b) => b.querySelector('.name')?.textContent === ${JSON.stringify(plan.tile)}); if (!b) return false; b.click(); return true; })()`).catch(() => false);
    const tc = now(); log(`reload: ${plan.tile_reload.open ? 'opened by its steps' : 'tile clicked again'}: ${ok}`); res.times.reload_click = +(tc - tr).toFixed(1);
    const r = new RegExp(plan.title ?? '.'); let first = null, lastShot = tc;
    for (const end = tc + (plan.tile_reload.secs ?? 600); now() < end;) {
      await watch();
      if (!first && (await wins()).some((w) => !isBase(w) && !isSetup(w) && r.test(w.title) && w.w > 8 && w.h > 8)) {
        first = now(); res.times.reload_window = +(first - tc).toFixed(1); log(`reload: first ${plan.title} window ${res.times.reload_window} s after the click`);
        // plan.tile_reload.after: steps once the window is up (e.g. ending the program, for its exit's own report)
        if (plan.tile_reload.after) { await sleep((plan.tile_reload.settle ?? 5) * 1000); const why = await run(plan.tile_reload.after); log(`reload: after steps ${why ?? 'done'}`); }
      }
      if (now() - lastShot >= 30) { lastShot = now(); await shot(`reload-${Math.round(now() - tc)}s`); }
      await sleep(1000);
    }
    if (!first) res.notes.push(`after the reload: no ${plan.title} window in ${plan.tile_reload.secs ?? 600} s`);
  }
  if (held) {
    res.cached = await cachedAudit(held, from);
    log(`reload: Cache Storage held ${res.cached.held} entries; ${res.cached.refetched.length} fetched again`);
    if (res.cached.refetched.length) res.first_error ??= `the reload fetched ${res.cached.refetched.length} things Cache Storage held: ${res.cached.refetched.slice(0, 5).join(', ')}`;
  }
}
done();
