// G2 (from G's site-smoke.mjs): console lines go to OUTDIR/console.txt as they come and every
// CDP call has a 20 s limit, so a hung tab still leaves its log and says when it hung.
// G: a game site in headless Chromium: the status line, the page's console
// errors, and a screenshot every STEP seconds (correctness only, no timing).
//   node site-smoke.mjs URL SECONDS OUTDIR [STEP]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, appendFileSync, openSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Cdp, browserWsUrl } from './cdp.mjs';

const READOUT = `(async()=>{const c=globalThis.__gexCompositor;return c?.readoutBase64?await c.readoutBase64():null;})()`;
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8);
    b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length); return b;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 3 })), chunk('IEND', Buffer.alloc(0))]);
}
const [url, secs = '300', outDir = 'smoke', step = '30'] = process.argv.slice(2);
const port = 9471 + Math.floor(Math.random() * 400);
mkdirSync(outDir, { recursive: true });
const prof = `${outDir}/profile`;
rmSync(prof, { recursive: true, force: true });
const chrome = spawn(process.env.CHROME || '/usr/bin/chromium', [
  '--headless', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu',
  ...(process.env.SMOKE_GPU ? ['--use-angle=vulkan', '--enable-features=Vulkan'] : ['--use-angle=swiftshader-webgl', '--use-webgpu-adapter=swiftshader']),
  '--ozone-platform=headless', '--ozone-override-screen-size=1300,800', '--window-size=1300,800',
  // SMOKE_SPKI=HASH: trust the server's key by its SPKI hash, so its responses are cached as a real visitor's
  // are (with --ignore-certificate-errors Chrome caches nothing from it).
  process.env.SMOKE_SPKI ? `--ignore-certificate-errors-spki-list=${process.env.SMOKE_SPKI}` : '--ignore-certificate-errors', '--disable-hang-monitor', '--no-first-run', '--no-default-browser-check',
  '--remote-allow-origins=*', ...(process.env.CHROME_EXTRA ? process.env.CHROME_EXTRA.split('|') : []), `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank',
], { stdio: ['ignore', openSync(`${outDir}/chrome.out`, 'a'), openSync(`${outDir}/chrome.err`, 'a')] });
writeFileSync(`${outDir}/chrome.pid`, String(chrome.pid));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { chrome.kill('SIGKILL'); } catch {} process.exit(1); });
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { console.log('FAIL ' + (e?.message ?? e)); chrome.kill(); process.exit(1); });
let ws = null;
for (let i = 0; i < 50 && !ws; i++) { await new Promise((r) => setTimeout(r, 200)); ws = await browserWsUrl(port); }
if (!ws) { console.log('FAIL chromium did not start'); chrome.kill(); process.exit(1); }
const cdp = await Cdp.connect(ws);
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
const lim = (pr, what, ms = 20000) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + what)), ms))]);
const s = (m, p) => lim(cdp.send(m, p, sessionId), m, m === 'Page.navigate' ? 300000 : 20000);
// SMOKE_MBPS=N (SMOKE_RTT ms, default 20): a fresh visit over an N Mbit/s link, on the page and every
// Worker it starts (their fetches and synchronous unit requests).
const net = process.env.SMOKE_MBPS ? { offline: false, latency: Number(process.env.SMOKE_RTT ?? 20), downloadThroughput: Number(process.env.SMOKE_MBPS) * 125000, uploadThroughput: 10e6 } : null;
// Workers' consoles too (the GL replay logs its compile errors there).
const workers = new Map();
cdp.on('Target.detachedFromTarget', (e) => workers.delete(e.sessionId));
cdp.on('Target.attachedToTarget', (e) => {
  globalThis.__wattached = (globalThis.__wattached ?? 0) + 1;
  workers.set(e.sessionId, e.targetInfo?.type);
  (globalThis.__wurl ??= new Map()).set(e.sessionId, e.targetInfo?.url ?? '');
  cdp.send('Runtime.enable', {}, e.sessionId).catch(() => {});
  cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, e.sessionId).catch(() => {});
  cdp.send('Runtime.runIfWaitingForDebugger', {}, e.sessionId).catch(() => {});
  if (net) cdp.send('Network.enable', {}, e.sessionId).then(() => cdp.send('Network.emulateNetworkConditions', net, e.sessionId)).catch(() => {});
});
await s('Runtime.enable'); await s('Page.enable');
if (net) { await s('Network.enable', {}); await s('Network.emulateNetworkConditions', net); } await s('Inspector.enable').catch(() => {});
cdp.on('Inspector.targetCrashed', () => { appendFileSync(`${outDir}/console.txt`, stamp() + ' [smoke] RENDERER CRASHED\n'); console.log('RENDERER CRASHED at ' + stamp()); setTimeout(() => { chrome.kill(); process.exit(0); }, 3000); });
cdp.on('Target.targetCrashed', (e) => { appendFileSync(`${outDir}/console.txt`, stamp() + ' [smoke] target crashed ' + JSON.stringify(e) + '\n'); });
await cdp.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
if (process.env.SMOKE_WORKERS) await s('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
const errs = [];
cdp.on('Runtime.exceptionThrown', (e) => errs.push(e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text));
const con = [];
const T0 = Date.now(); const stamp = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(7);
// SMOKE_TCPU=MS (WD): every MS ms, each thread of Chromium's processes whose CPU time (utime+stime, clock
// ticks) moved since the last sample, as `STAMP pid tid comm ticks` lines in OUTDIR/tcpu.txt (console.txt's clock).
if (process.env.SMOKE_TCPU) {
  const { readdirSync } = await import('node:fs');
  const last = new Map();
  const st = (p) => { try { const s = readFileSync(p, 'utf8'); const r = s.slice(s.lastIndexOf(')') + 2).split(' '); return { ppid: +r[1], ticks: +r[11] + +r[12], comm: s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')).replace(/ /g, '_') }; } catch { return null; } };
  setInterval(() => {
    const kids = new Map(); for (const p of readdirSync('/proc')) if (/^\d+$/.test(p)) { const s = st(`/proc/${p}/stat`); if (s) kids.set(+p, s.ppid); }
    const mine = new Set([chrome.pid]); let grew = true; while (grew) { grew = false; for (const [p, pp] of kids) if (!mine.has(p) && mine.has(pp)) { mine.add(p); grew = true; } }
    let out = ''; const now = stamp();
    for (const p of mine) { let ts; try { ts = readdirSync(`/proc/${p}/task`); } catch { continue; }
      for (const t of ts) { const s = st(`/proc/${p}/task/${t}/stat`); if (!s) continue; const k = `${p}/${t}`;
        if (last.get(k) !== s.ticks) { last.set(k, s.ticks); out += `${now} ${p} ${t} ${s.comm} ${s.ticks}\n`; } } }
    if (out) appendFileSync(`${outDir}/tcpu.txt`, out);
  }, Number(process.env.SMOKE_TCPU)).unref();
}
cdp.on('Runtime.consoleAPICalled', (e) => { appendFileSync(`${outDir}/console.txt`, stamp() + ' ' + e.args.map((a) => a.value ?? a.description).join(' ') + '\n'); con.push(e.args.map((a) => a.value ?? a.description).join(' ')); if (e.type === 'error') errs.push(e.args.map((a) => a.value ?? a.description).join(' ')); });
// SMOKE_PRELOAD=JS (TH): run before the page's own scripts.
if (process.env.SMOKE_PRELOAD) await s('Page.addScriptToEvaluateOnNewDocument', { source: process.env.SMOKE_PRELOAD });
// SMOKE_PRELOAD_FILE=PATH (WD): the same from a file; a relative PATH is this script's directory's.
if (process.env.SMOKE_PRELOAD_FILE) await s('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(new URL(process.env.SMOKE_PRELOAD_FILE, import.meta.url), 'utf8') });
await s('Page.navigate', { url });
const t0 = Date.now();
const ev = async (x) => (await s('Runtime.evaluate', { expression: x, returnByValue: true })).result?.value;
let n = 0;
// SMOKE_KEYS="T:Key,T:Key,..." -- at T s press Key (a DOM key name: Enter, Escape, ArrowRight, " ", z...),
// held SMOKE_HOLD ms (default 300). The first press clicks the page centre first, for focus.
const KEYCODES = { Enter: 13, Escape: 27, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Tab: 9, Backspace: 8, Delete: 46, Home: 36, End: 35 };
const CODES = { Enter: 'Enter', Escape: 'Escape', ' ': 'Space', ArrowLeft: 'ArrowLeft', ArrowUp: 'ArrowUp', ArrowRight: 'ArrowRight', ArrowDown: 'ArrowDown', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End' };
for (let i = 1; i <= 12; i++) { KEYCODES['F' + i] = 111 + i; CODES['F' + i] = 'F' + i; }
const keys = (process.env.SMOKE_KEYS ?? '').split(',').filter(Boolean).map((k) => { const i = k.indexOf(':'); return { t: Number(k.slice(0, i)), key: k.slice(i + 1) === 'Space' ? ' ' : k.slice(i + 1) }; });
// SMOKE_NOCLICK=1 (TH): keys go to the page as they are, with no click for focus first.
let focused = !!process.env.SMOKE_NOCLICK;
const evalAt = (process.env.SMOKE_EVAL_AT ?? '').split(',').filter(Boolean).map(Number);
const press = async (key) => {
  // wheel:DY[:N[:DX]] -- N mouseWheel events (default 1) of DY/DX px at the page centre, 16 ms apart
  if (key.startsWith('wheel:')) {
    const [, dy, n = '1', dx = '0'] = key.split(':');
    await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 400 }).catch(() => {});
    for (let i = 0; i < Number(n); i++) {
      await s('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: Number(dx), deltaY: Number(dy) }).catch(() => {});
      await new Promise((r) => setTimeout(r, 16));
    }
    appendFileSync(`${outDir}/console.txt`, stamp() + ` [smoke] ${key}\n`);
    return;
  }
  // `click:X:Y`: a click at X,Y of the compositor's output (the readout's pixels), mapped
  // through the largest canvas's place and scale on the page.
  // dblclick:X:Y (WD): two quick clicks there, the second with clickCount 2.
  // drag:X1:Y1:X2:Y2 (WD): the left button pressed at X1,Y1, moved to X2,Y2 in steps, released there.
  // rclick:X:Y (WD): a right click.
  if (key.startsWith('drag:') || key.startsWith('rclick:')) {
    focused = true;
    const v = key.split(':').slice(1).map(Number);
    const r = await ev("(() => { let b = null; for (const c of document.querySelectorAll('canvas')) { const q = c.getBoundingClientRect(); if (!b || q.width * q.height > b.w * b.h) b = { x: q.x, y: q.y, w: q.width, h: q.height }; } return b; })()");
    const W = Number(process.env.SMOKE_OUT_W ?? 1280), H = Number(process.env.SMOKE_OUT_H ?? 720);
    const at = (cx, cy) => (r ? [r.x + cx * r.w / W, r.y + cy * r.h / H] : [cx, cy]);
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    if (key.startsWith('rclick:')) {
      const [x, y] = at(v[0], v[1]);
      await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }).catch(() => {});
      await sleep(100);
      await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 }).catch(() => {});
      await sleep(150);
      await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 }).catch(() => {});
    } else {
      const [x1, y1] = at(v[0], v[1]), [x2, y2] = at(v[2], v[3]);
      await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 }).catch(() => {});
      await sleep(100);
      await s('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 }).catch(() => {});
      for (let i = 1; i <= 20; i++) {
        await sleep(40);
        await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / 20, y: y1 + (y2 - y1) * i / 20, button: 'left', buttons: 1 }).catch(() => {});
      }
      await sleep(200);
      await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 }).catch(() => {});
    }
    appendFileSync(`${outDir}/console.txt`, stamp() + ` [smoke] ${key}\n`);
    return;
  }
  if (key.startsWith('click:') || key.startsWith('dblclick:')) {
    focused = true;
    const dbl = key.startsWith('dbl');
    const [, cx, cy] = key.split(':').map(Number);
    const r = await ev("(() => { let b = null; for (const c of document.querySelectorAll('canvas')) { const q = c.getBoundingClientRect(); if (!b || q.width * q.height > b.w * b.h) b = { x: q.x, y: q.y, w: q.width, h: q.height, cw: c.width, ch: c.height }; } return b; })()");
    const W = Number(process.env.SMOKE_OUT_W ?? 1280), H = Number(process.env.SMOKE_OUT_H ?? 720);
    const x = r ? r.x + cx * r.w / W : cx, y = r ? r.y + cy * r.h / H : cy;
    await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }).catch(() => {});
    await new Promise((res) => setTimeout(res, 100));
    for (let c = 1; c <= (dbl ? 2 : 1); c++) {
      await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: c }).catch(() => {});
      await new Promise((res) => setTimeout(res, dbl ? 60 : Number(process.env.SMOKE_HOLD ?? 300)));
      await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: c }).catch(() => {});
      if (dbl && c === 1) await new Promise((res) => setTimeout(res, 80));
    }
    appendFileSync(`${outDir}/console.txt`, stamp() + ` [smoke] ${key} -> page ${x.toFixed(0)},${y.toFixed(0)} canvas ${JSON.stringify(r)}\n`);
    return;
  }
  // type:TEXT (WD): each character of TEXT pressed in turn (lower case, digits, space and . - _ / \\ : , | < > % " & ( ) * ~ only;
  // `+` stands for a space, `\+` for a plus sign).
  if (key.startsWith('type:')) {
    const PUNCT = { '.': ['Period', 190], '-': ['Minus', 189], '_': ['Minus', 189], '/': ['Slash', 191], '\\': ['Backslash', 220], ':': ['Semicolon', 186], ' ': ['Space', 32], ',': ['Comma', 188], '|': ['Backslash', 220], '+': ['Equal', 187], '(': ['Digit9', 57], ')': ['Digit0', 48], '*': ['Digit8', 56], '~': ['Backquote', 192], '<': ['Comma', 188], '>': ['Period', 190], '%': ['Digit5', 53], '"': ['Quote', 222], '&': ['Digit7', 55] };
    for (const ch of key.slice(5).split('\\+').map((p) => p.replace(/\+/g, ' ')).join('+')) {
      const [code, vk] = PUNCT[ch] ?? (/[a-z]/.test(ch) ? ['Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0)] : ['Digit' + ch, ch.charCodeAt(0)]);
      const shift = ':_|<>%"&+()*~'.includes(ch) ? 8 : 0;
      // The guest tracks Shift from its own key events, not the modifiers field: press it.
      if (shift) await s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', modifiers: 8, windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 }).catch(() => {});
      await s('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, modifiers: shift, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: ch }).catch((e) => appendFileSync(`${outDir}/console.txt`, stamp() + ` [smoke] key ${ch}: ${e.message}\n`));
      await new Promise((r) => setTimeout(r, 60));
      await s('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, modifiers: shift, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }).catch(() => {});
      if (shift) await s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', modifiers: 0, windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 60));
    }
    appendFileSync(`${outDir}/console.txt`, stamp() + ` [smoke] ${key}\n`);
    return;
  }
  // ctrl:X (WD): Ctrl+X, X one letter.
  if (key.startsWith('ctrl:')) {
    const ch = key.slice(5).toLowerCase(), vk = ch.toUpperCase().charCodeAt(0), code = 'Key' + ch.toUpperCase();
    await s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', modifiers: 2, windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 60));
    await s('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, modifiers: 2, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }).catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    await s('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, modifiers: 2, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }).catch(() => {});
    await new Promise((r) => setTimeout(r, 60));
    await s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', modifiers: 0, windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 }).catch(() => {});
    appendFileSync(`${outDir}/console.txt`, stamp() + ` [smoke] ${key}\n`);
    return;
  }
  if (key === 'click') {
    focused = true;
    await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 400 }).catch(() => {});
    await s('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', clickCount: 1 }).catch(() => {});
    await new Promise((r) => setTimeout(r, Number(process.env.SMOKE_HOLD ?? 300)));
    await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 400, button: 'left', clickCount: 1 }).catch(() => {});
    appendFileSync(`${outDir}/console.txt`, stamp() + ' [smoke] click\n');
    return;
  }
  if (!focused) { focused = true; for (const type of ['mousePressed', 'mouseReleased']) await s('Input.dispatchMouseEvent', { type, x: 640, y: 400, button: 'left', clickCount: 1 }).catch(() => {}); }
  const one = key.length === 1;
  const vk = KEYCODES[key] ?? (one ? key.toUpperCase().charCodeAt(0) : 0);
  const code = CODES[key] ?? (one ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : 'Digit' + key) : key);
  if (process.env.SMOKE_KEYLOG && !globalThis.__kl) { globalThis.__kl = 1; await ev("addEventListener('keydown', (e) => console.log('[smoke-dom] keydown', e.code, 'target', e.target?.tagName, e.target?.className, 'active', document.activeElement?.tagName, document.activeElement?.className), true), 1").catch(() => {}); }
  await s('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(one ? { text: key } : {}) }).catch(() => {});
  await new Promise((r) => setTimeout(r, Number(process.env.SMOKE_HOLD ?? 300)));
  await s('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }).catch(() => {});
  appendFileSync(`${outDir}/console.txt`, stamp() + ` [smoke] key ${JSON.stringify(key)}\n`);
};
while ((Date.now() - t0) / 1000 < Number(secs)) {
  await new Promise((r) => setTimeout(r, Number(step) * 1000));
  const t = Math.round((Date.now() - t0) / 1000);
  while (keys.length && keys[0].t <= t) await press(keys.shift().key);
  // SMOKE_RESIZE_AT=T:WxH,... (TH): the page's viewport becomes WxH at T s.
  for (const r of (globalThis.__resizes ??= (process.env.SMOKE_RESIZE_AT ?? '').split(',').filter(Boolean).map((x) => { const [tt, wh] = x.split(':'); const [w, h] = wh.split('x').map(Number); return { t: Number(tt), w, h }; }))) {
    if (!r.done && r.t <= t) { r.done = true; await s('Emulation.setDeviceMetricsOverride', { width: r.w, height: r.h, deviceScaleFactor: 1, mobile: false }).catch(() => {}); appendFileSync(`${outDir}/console.txt`, stamp() + ` [smoke] viewport ${r.w}x${r.h}\n`); }
  }
  // SMOKE_DROP=T:X:Y:PATH|PATH,... (WD): at T s, files from this machine dragged in and dropped at page X,Y
  // (Input.dispatchDragEvent: dragEnter, dragOver, drop), as a person drops them from a file manager.
  for (const d of (globalThis.__drops ??= (process.env.SMOKE_DROP ?? '').split(',').filter(Boolean).map((x) => { const [tt, dx, dy, ps] = x.split(':'); return { t: Number(tt), x: Number(dx), y: Number(dy), files: ps.split('|') }; }))) {
    if (d.done || d.t > t) continue;
    d.done = true;
    const data = { items: [], files: d.files, dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await s('Input.dispatchDragEvent', { type, x: d.x, y: d.y, data }).catch((e) => appendFileSync(`${outDir}/console.txt`, stamp() + ` [smoke] drag ${type}: ${e.message}\n`));
      await new Promise((r) => setTimeout(r, 200));
    }
    appendFileSync(`${outDir}/console.txt`, stamp() + ` [smoke] dropped ${d.files.join(' ')} at ${d.x},${d.y}\n`);
  }
  // SMOKE_EVAL_AT=T1,T2,...: also run SMOKE_EVAL_AT_B64 (default SMOKE_EVAL_B64) at those seconds.
  while (evalAt.length && evalAt[0] <= t) {
    evalAt.shift();
    const x = Buffer.from(process.env.SMOKE_EVAL_AT_B64 || process.env.SMOKE_EVAL_B64 || '', 'base64').toString();
    if (x) console.log(`[smoke-eval@${t}]`, JSON.stringify(await s('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }).then((r) => r.result?.value, (e) => 'eval: ' + e.message)));
  }
  let status;
  try {
    status = await ev("document.getElementById('status')?.textContent");
    const shot = await s('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${outDir}/s-${String(n).padStart(3, '0')}-${t}s.png`, Buffer.from(shot.data, 'base64'));
    // On a real GPU the browser's screenshot misses the WebGPU canvas: also save the compositor's own readout.
    if (process.env.SMOKE_GPU) {
      const r = (await s('Runtime.evaluate', { expression: READOUT, returnByValue: true, awaitPromise: true }).catch(() => null))?.result?.value;
      if (r?.b64) writeFileSync(`${outDir}/r-${String(n).padStart(3, '0')}-${t}s.png`, png(r.w, r.h, Buffer.from(r.b64, 'base64')));
    }
    n++;
  } catch (e) { console.log(`${t}s HUNG: ${e.message}`); appendFileSync(`${outDir}/console.txt`, stamp() + ' [smoke] HUNG ' + e.message + '\n'); continue; }
  let mem = '';
  try { const { execSync } = await import('node:child_process'); mem = execSync(`ps -eo rss,args | grep -F -- 'user-data-dir=${prof}' | grep -F -- '--type=renderer' | grep -v grep | awk '{s+=$1} END {print int(s/1024)}'`).toString().trim(); } catch {}
  // TH: each renderer's VmData and VmRSS from /proc (MiB).
  try { const { execSync } = await import('node:child_process'); const pids = execSync(`pgrep -f -- 'user-data-dir=${prof}.*--type=renderer|--type=renderer.*user-data-dir=${prof}' || true`).toString().trim().split(/\s+/).filter(Boolean); const fs = await import('node:fs'); mem += ' [' + pids.map((p) => { try { const st = fs.readFileSync(`/proc/${p}/status`, 'utf8'); const g = (k) => Math.round(Number(new RegExp(k + ':\\s+(\\d+)').exec(st)?.[1] ?? 0) / 1024); return `pid ${p} VmData ${g('VmData')} VmRSS ${g('VmRSS')}`; } catch { return `pid ${p} gone`; } }).join('; ') + ']'; } catch {}
  let heap = 0, top = 0, nw = 0, topSid = null;
  await Promise.all([...workers.keys()].map(async (sid) => {
    const r = await lim(cdp.send('Runtime.getHeapUsage', {}, sid), 'heap', 5000).catch(() => null);
    if (r) { nw++; heap += r.usedSize; const k = process.env.SMOKE_SMALLEST ? -r.usedSize : r.usedSize; if (!topSid || k > top) { top = k; topSid = sid; } }
  }));
  // SMOKE_HEAPSAMPLE=T0,T1: sample allocations (still live) on the largest Worker from T0 s,
  // and at T1 s write where they were made, by function, to OUTDIR/heap-sample.txt.
  const hs = (process.env.SMOKE_HEAPSAMPLE ?? '').split(',').map(Number);
  if (hs.length === 2 && !globalThis.__hsSid && t >= hs[0] && topSid) {
    globalThis.__hsSid = topSid;
    await lim(cdp.send('HeapProfiler.enable', {}, topSid), 'hp', 5000).catch(() => {});
    await lim(cdp.send('HeapProfiler.startSampling', { samplingInterval: 65536 }, topSid), 'hp', 5000).catch((e) => console.log('sampling: ' + e.message));
    console.log(`${t}s heap sampling started on the largest Worker`);
  }
  if (hs.length === 2 && globalThis.__hsSid && !globalThis.__hsDone && t >= hs[1]) {
    globalThis.__hsDone = 1;
    const r = await lim(cdp.send('HeapProfiler.stopSampling', {}, globalThis.__hsSid), 'hp', 60000).catch((e) => ({ err: e.message }));
    const by = new Map();
    const walk = (n, stack) => {
      const f = n.callFrame; const here = `${f.functionName || '(anon)'} ${f.url.split('/').pop().slice(0, 8)}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
      const st = [...stack, here];
      if (n.selfSize) { const k = st.slice(-Number(process.env.SMOKE_HEAPDEPTH || 3)).join(' < '); by.set(k, (by.get(k) ?? 0) + n.selfSize); }
      for (const c of n.children ?? []) walk(c, st);
    };
    if (r?.profile?.head) walk(r.profile.head, []);
    const rows = [...by].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${(v / 1048576).toFixed(1).padStart(8)} MiB  ${k}`);
    writeFileSync(`${outDir}/heap-sample.txt`, (r?.err ? 'error ' + r.err + '\n' : '') + rows.join('\n') + '\n');
    console.log(`${t}s heap sample written`);
  }
  // SMOKE_QUERY=T1,T2,...: at each T s count live objects by prototype on the largest
  // Worker (Runtime.queryObjects), appended to OUTDIR/query.txt.
  const qs = (process.env.SMOKE_QUERY ?? '').split(',').filter(Boolean).map(Number);
  globalThis.__qDone ??= new Set();
  for (const qt of qs) {
    if (t < qt || globalThis.__qDone.has(qt) || !topSid) continue;
    globalThis.__qDone.add(qt);
    const protos = {
      Error: 'Error.prototype', RuntimeError: 'WebAssembly.RuntimeError.prototype',
      WasmException: 'WebAssembly.Exception.prototype', Promise: 'Promise.prototype',
      Array: 'Array.prototype', Function: 'Function.prototype', Map: 'Map.prototype', Set: 'Set.prototype',
      Table: 'WebAssembly.Table.prototype', Instance: 'WebAssembly.Instance.prototype',
      Module: 'WebAssembly.Module.prototype', Global: 'WebAssembly.Global.prototype',
      ArrayBuffer: 'ArrayBuffer.prototype', DataView: 'DataView.prototype',
      TypedArray: 'Object.getPrototypeOf(Uint8Array.prototype)',
      Generator: 'Object.getPrototypeOf(function*(){}).prototype',
      WeakRef: 'WeakRef.prototype', MessagePort: 'globalThis.MessagePort?.prototype ?? {}',
    };
    const sizeFn = `function(){let n=this.length,s=0,mx=0;for(const o of this){let v=0;try{v=o instanceof Map||o instanceof Set?o.size:o instanceof WebAssembly.Table?o.length:Array.isArray(o)?o.length:o?.byteLength??0}catch{}s+=v;if(v>mx)mx=v}return n+' total '+s+' max '+mx}`;
    const out = [];
    for (const [name, expr] of Object.entries(protos)) {
      try {
        const p = await lim(cdp.send('Runtime.evaluate', { expression: expr }, topSid), 'q', 20000);
        if (!p?.result?.objectId) { out.push(`${name}: n/a`); continue; }
        const q = await lim(cdp.send('Runtime.queryObjects', { prototypeObjectId: p.result.objectId }, topSid), 'q', 120000);
        const c = await lim(cdp.send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: sizeFn, returnByValue: true }, topSid), 'q', 120000);
        out.push(`${name}: ${c?.result?.value}`);
        await cdp.send('Runtime.releaseObjectGroup', { objectGroup: '' }, topSid).catch(() => {});
      } catch (err) { out.push(`${name}: error ${err.message}`); }
    }
    const { appendFileSync } = await import('node:fs');
    appendFileSync(`${outDir}/query.txt`, `${t}s (largest ${(top / 1048576).toFixed(0)} MiB)\n  ${out.join('\n  ')}\n`);
    console.log(`${t}s object query written`);
  }
  // SMOKE_SNAPSHOT=T: at T s write a heap snapshot of the largest Worker to OUTDIR/worker.heapsnapshot.
  if (process.env.SMOKE_SNAPSHOT && !globalThis.__snapDone && t >= Number(process.env.SMOKE_SNAPSHOT) && topSid) {
    globalThis.__snapDone = 1;
    const { openSync: o, writeSync: w, closeSync: c } = await import('node:fs');
    const fd = o(`${outDir}/worker.heapsnapshot`, 'w'); let bytes = 0;
    const h = (p, sid) => { if (sid === topSid) { w(fd, p.chunk); bytes += p.chunk.length; } };
    cdp.on('HeapProfiler.addHeapSnapshotChunk', h);
    await lim(cdp.send('HeapProfiler.enable', {}, topSid), 'hp', 5000).catch(() => {});
    if (process.env.SMOKE_PAUSE) {
      const paused = new Promise((res) => cdp.on('Debugger.paused', (p, sid) => { if (sid === topSid) res(); }));
      await lim(cdp.send('Debugger.enable', {}, topSid), 'dbg', 120000).catch((e) => console.log('dbg enable: ' + e.message));
      await lim(cdp.send('Debugger.pause', {}, topSid), 'pause', 60000).catch((e) => console.log('pause: ' + e.message));
      await lim(paused, 'paused', 120000).then(() => console.log(`${t}s worker paused`)).catch((e) => console.log('paused: ' + e.message));
    }
    const r = await lim(cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false }, topSid), 'snap', 600000).catch((e) => ({ err: e.message }));
    c(fd);
    if (process.env.SMOKE_PAUSE) await lim(cdp.send('Debugger.resume', {}, topSid), 'resume', 30000).catch(() => {});
    console.log(`${t}s snapshot of largest Worker (${(top / 1048576).toFixed(0)} MiB): ${bytes} bytes ${r?.err ?? ''}`);
  }
  // DIRK: SMOKE_TRACE=T,SECS: a Chrome trace (toplevel, timeline, gpu, V8 sampling) from T s for SECS s,
  // to OUTDIR/trace.json: per-thread (OS tid) task and thread time, and which code each worker thread runs.
  const tr = (process.env.SMOKE_TRACE ?? '').split(',').map(Number);
  if (tr.length === 2 && !globalThis.__trOn && t >= tr[0]) {
    globalThis.__trOn = 1;
    const cats = process.env.SMOKE_TRACE_CATS ?? 'toplevel,devtools.timeline,disabled-by-default-devtools.timeline,v8.execute,gpu,disabled-by-default-v8.cpu_profiler,__metadata';
    await lim(cdp.send('Tracing.start', { traceConfig: { includedCategories: cats.split(','), excludedCategories: ['*'] }, transferMode: 'ReturnAsStream' }), 'trace start', 30000)
      .then(() => console.log(`${t}s tracing`), (e) => console.log('trace start: ' + e.message));
    setTimeout(async () => {
      const done = new Promise((r) => cdp.on('Tracing.tracingComplete', (e) => r(e)));
      await cdp.send('Tracing.end').catch((e) => console.log('trace end: ' + e.message));
      const e = await lim(done, 'trace complete', 120000).catch((x) => ({ err: x.message }));
      if (!e.stream) { console.log('trace: ' + (e.err ?? 'no stream')); return; }
      const fd = openSync(`${outDir}/trace.json`, 'w'); let n = 0;
      for (;;) { const r = await cdp.send('IO.read', { handle: e.stream, size: 1 << 20 }); const b = r.base64Encoded ? Buffer.from(r.data, 'base64') : Buffer.from(r.data); appendFileSync(fd, b); n += b.length; if (r.eof) break; }
      await cdp.send('IO.close', { handle: e.stream }).catch(() => {});
      console.log(`trace written, ${(n / 1048576).toFixed(1)} MiB`);
    }, tr[1] * 1000);
  }
  // DIRK: SMOKE_HEAPUSE=T: once at T s, every Worker's Runtime.getHeapUsage (V8 heap, embedder heap,
  // array buffer backing stores) to the console, which says what fills a worker's global GC limit.
  const hu = Number(process.env.SMOKE_HEAPUSE ?? 0);
  if (hu && !globalThis.__huDone && t >= hu) {
    globalThis.__huDone = 1;
    for (const sid of [...workers.keys(), sessionId]) {
      const r = await lim(cdp.send('Runtime.getHeapUsage', {}, sid), 'heapuse', 20000).catch((e) => ({ err: e.message }));
      // And every WebAssembly.Memory the isolate holds, by size: V8 counts each one, shared or not, in
      // the global size its GC limit is set from.
      let mems = '';
      if (process.env.SMOKE_HEAPUSE_NOMEM) { console.log(`${t}s heap use ${sid === sessionId ? 'page' : (globalThis.__wurl.get(sid) ?? '?').split('/').pop()}: ${JSON.stringify(r)}`); continue; }
      try {
        const proto = await lim(cdp.send('Runtime.evaluate', { expression: 'WebAssembly.Memory.prototype' }, sid), 'proto', 20000);
        const objs = await lim(cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId }, sid), 'query', 60000);
        const v = await lim(cdp.send('Runtime.callFunctionOn', { objectId: objs.objects.objectId, returnByValue: true,
          functionDeclaration: 'function () { return this.map((m) => m.buffer.byteLength); }' }, sid), 'sizes', 20000);
        const sz = v.result.value ?? [];
        mems = ` memories ${sz.length}, ${(sz.reduce((a, b) => a + b, 0) / 1048576).toFixed(0)} MiB: ${sz.map((b) => (b / 1048576).toFixed(0)).join(' ')}`;
      } catch (e) { mems = ' memories: ' + e.message; }
      console.log(`${t}s heap use ${sid === sessionId ? 'page' : (globalThis.__wurl.get(sid) ?? '?').split('/').pop()}: ${JSON.stringify(r)}${mems}`);
    }
  }
  // JS: SMOKE_ABUF=T: once at T s, every ArrayBuffer and SharedArrayBuffer of 1 MiB or more the page's
  // isolate holds, by size (queryObjects collects first).
  const ab = Number(process.env.SMOKE_ABUF ?? 0);
  if (ab && !globalThis.__abDone && t >= ab) {
    globalThis.__abDone = 1;
    for (const ctor of ['ArrayBuffer', 'SharedArrayBuffer', 'WebAssembly.Memory', 'WebAssembly.Module']) {
      try {
        const proto = await lim(cdp.send('Runtime.evaluate', { expression: `${ctor}.prototype` }, sessionId), 'proto', 20000);
        const objs = await lim(cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId }, sessionId), 'query', 120000);
        const v = await lim(cdp.send('Runtime.callFunctionOn', { objectId: objs.objects.objectId, returnByValue: true,
          functionDeclaration: ctor === 'WebAssembly.Module' ? 'function () { return this.length; }' : ctor === 'WebAssembly.Memory' ? 'function () { return this.map((m) => m.buffer.byteLength); }' : 'function () { return this.map((b) => b.byteLength); }' }, sessionId), 'sizes', 20000);
        const sz = Array.isArray(v.result.value) ? v.result.value : [v.result.value];
        const big = sz.filter((b) => b >= 1 << 20).sort((a, b) => b - a);
        console.log(`${t}s page ${ctor}: ${sz.length}, total ${(sz.reduce((a, b) => a + (b | 0), 0) / 1048576).toFixed(0)} MiB; >=1 MiB: ${big.map((b) => (b / 1048576).toFixed(1)).join(' ')}`);
      } catch (e) { console.log(`${t}s page ${ctor}: ${e.message}`); }
    }
  }
  // DIRK: SMOKE_MEMSTAT=T: once at T s, which guest thread every Worker runs (__gexWho), how many Workers
  // each process has (each holds its memory), and for one Worker per process __gexMemStat (memstat-patch.py):
  // the memory's length against what of it is not zero. Reads every byte: a measurement run only.
  const ms = Number(process.env.SMOKE_MEMSTAT ?? 0);
  if (ms && !globalThis.__msDone && t >= ms) {
    globalThis.__msDone = 1;
    const byPid = new Map();
    for (const sid of workers.keys()) {
      const r = await lim(cdp.send('Runtime.evaluate', { expression: 'JSON.stringify(globalThis.__gexWho?.() ?? null)', returnByValue: true }, sid), 'who', 20000).catch((e) => ({ err: e.message }));
      const w = r?.result?.value ? JSON.parse(r.result.value) : null;
      const k = w?.pid ?? `none:${(globalThis.__wurl.get(sid) ?? '?').split('/').pop()}`;
      if (!byPid.has(k)) byPid.set(k, { sids: [], cmd: w?.cmdline });
      byPid.get(k).sids.push(sid);
    }
    for (const [pid, { sids, cmd }] of byPid) {
      let st = '';
      if (typeof pid === 'number') {
        const r = await lim(cdp.send('Runtime.evaluate', { expression: 'globalThis.__gexMemStat?.() ?? null', returnByValue: true }, sids[0]), 'memstat', 180000).catch((e) => ({ err: e.message }));
        st = r?.result?.value ?? r?.err ?? '';
      }
      console.log(`${t}s memstat pid ${pid} workers ${sids.length} ${JSON.stringify(cmd ?? '').slice(0, 80)} ${st}`);
    }
  }
  // SMOKE_CPUPROF=T,SECS: V8 CPU profile of every Worker from T s for SECS s; self time by function
  // per Worker (URL, tid unknown) to OUTDIR/cpuprof.txt. Sampling inflates gex: use for shares only.
  const cp = (process.env.SMOKE_CPUPROF ?? '').split(',').map(Number);
  if (cp.length === 2 && !globalThis.__cpOn && t >= cp[0]) {
    globalThis.__cpOn = [...workers.keys()];
    await Promise.all(globalThis.__cpOn.map(async (sid) => {
      await lim(cdp.send('Profiler.enable', {}, sid), 'prof', 30000).catch(() => {});
      await lim(cdp.send('Profiler.setSamplingInterval', { interval: 2000 }, sid), 'prof', 30000).catch(() => {});
      await lim(cdp.send('Profiler.start', {}, sid), 'prof', 30000).catch((e) => console.log('prof start: ' + e.message));
    }));
    globalThis.__cpT = t; console.log(`${t}s cpu profiling ${globalThis.__cpOn.length} workers`);
  }
  if (globalThis.__cpOn && !globalThis.__cpDone && t >= globalThis.__cpT + cp[1]) {
    globalThis.__cpDone = 1;
    let txt = '';
    await Promise.all(globalThis.__cpOn.map(async (sid) => {
      const r = await lim(cdp.send('Profiler.stop', {}, sid), 'prof', 120000).catch((e) => ({ err: e.message }));
      const pr = r?.profile; if (!pr) { txt += `worker ${globalThis.__wurl.get(sid)}: ${r?.err}\n`; return; }
      const self = new Map(); const byId = new Map(pr.nodes.map((n) => [n.id, n])); let tot = 0;
      const dt = pr.timeDeltas ?? []; (pr.samples ?? []).forEach((id, i) => {
        const n = byId.get(id); const cf = n.callFrame; const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber}`;
        const d = dt[i] ?? 0; tot += d; self.set(k, (self.get(k) ?? 0) + d); });
      if (tot < 1e6) return;
      // Inclusive time (H): each function once per sample on its stack; SMOKE_CPUPROF_RAW=1 also keeps the profile.
      const par = new Map(); for (const n of pr.nodes) for (const c of n.children ?? []) par.set(c, n.id);
      const kOf = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
      const incl = new Map(); (pr.samples ?? []).forEach((id, i) => { const d = dt[i] ?? 0; const seen = new Set();
        for (let x = id; x !== undefined; x = par.get(x)) { const k = kOf(byId.get(x)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + d); } } });
      const itop = [...incl].filter(([k]) => !/^\(root\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 80);
      const idle = [...self].filter(([k]) => k.startsWith('(idle)')).reduce((a, [, v]) => a + v, 0);
      if (process.env.SMOKE_CPUPROF_RAW && idle < 0.8 * tot) writeFileSync(`${outDir}/cpuprof-${String(sid).slice(-8)}.json`, JSON.stringify(pr));
      const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 60);
      const mods = new Map(); for (const [k, v] of self) { const m = k.slice(k.lastIndexOf(' ') + 1).replace(/:\d+$/, '') || k; mods.set(m, (mods.get(m) ?? 0) + v); }
      const mtop = [...mods].sort((a, b) => b[1] - a[1]).slice(0, 15);
      txt += `== worker ${globalThis.__wurl.get(sid)} sampled ${(tot / 1e6).toFixed(1)} s\n` + top.map(([k, v]) => `  ${(100 * v / tot).toFixed(1).padStart(5)}%  ${k}`).join('\n') + '\n'
        + '  -- by module:\n' + mtop.map(([k, v]) => `  ${(100 * v / tot).toFixed(1).padStart(5)}%  [${k}]`).join('\n') + '\n'
        + '  -- inclusive:\n' + itop.map(([k, v]) => `  ${(100 * v / tot).toFixed(1).padStart(5)}%  ${k}`).join('\n') + '\n';
    }));
    writeFileSync(`${outDir}/cpuprof.txt`, txt); console.log(`${t}s cpu profile written`);
  }
  const mainHeap = await s('Runtime.getHeapUsage').then((r) => r.usedSize).catch(() => 0);
  console.log(`${t}s status: ${status} renderers ${mem} MiB; JS heap main ${(mainHeap / 1048576).toFixed(0)} MiB, ${nw} workers ${(heap / 1048576).toFixed(0)} MiB (largest ${(top / 1048576).toFixed(0)}), ${globalThis.__wattached ?? 0} attached so far`);
  if (/failed|exited/.test(status ?? '')) break;
}
if (process.env.SMOKE_EVAL_B64) console.log('[smoke-eval]', JSON.stringify(await s('Runtime.evaluate', { expression: Buffer.from(process.env.SMOKE_EVAL_B64, 'base64').toString(), returnByValue: true, awaitPromise: true }).then((r) => r.result?.value, (e) => 'eval: ' + e.message)));
// SMOKE_AUDIO=1 (TH): the page's played audio (a patched worklet's left channel, globalThis.__rec) as OUTDIR/audio.wav,
// and the worklet's reports (underruns) as OUTDIR/audio.json.
if (process.env.SMOKE_AUDIO) {
  const n = await ev('(globalThis.__rec ?? []).length').catch(() => 0);
  const rate = await ev('globalThis.__recRate ?? 48000').catch(() => 48000);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const b64 = await ev(`(() => { const a = globalThis.__rec[${i}]; const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let k = 0; k < u.length; k += 32768) s += String.fromCharCode.apply(null, u.subarray(k, k + 32768)); return btoa(s); })()`).catch(() => '');
    parts.push(Buffer.from(b64, 'base64'));
  }
  const pcm = Buffer.concat(parts);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(`${outDir}/audio.wav`, Buffer.concat([h, pcm]));
  writeFileSync(`${outDir}/audio.json`, JSON.stringify(await ev('globalThis.__gexAudio?.history ?? null').catch(() => null)));
  console.log(`audio: ${(pcm.length / 2 / rate).toFixed(1)} s recorded at ${rate} Hz`);
}
const out = await ev("globalThis.__game?.out?.() ?? globalThis.__nt?.out ?? ''").catch((e) => 'out: ' + e.message);
writeFileSync(`${outDir}/out.txt`, String(out ?? ''));

const log = await ev("document.getElementById('log')?.textContent").catch(() => '');
if (log) console.log('page log:', log.slice(-1500));
if (errs.length) console.log('console errors:\n' + errs.slice(0, 15).join('\n'));
chrome.kill();
await new Promise((r) => chrome.once('exit', r));
rmSync(prof, { recursive: true, force: true, maxRetries: 5 });
process.exit(0);
