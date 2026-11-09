// appsweep.mjs URL OUTDIR PLAN.json: one app's install-and-run check on the windemo page in headless Chromium.
// The installer reaches the guest the way a visitor's does (dragged from the host onto the page); cmd runs it
// and its exit status comes back as cmd's window title; then the installed program is started and must show
// a window, and one interaction (a click in it and a few keys) must leave it alive.
// PLAN: {id, drop: [host paths], install: "cmd line" | null, interactive: [steps] | null, launch: "cmd line",
//        title: "regex" (the program's window; default any new window), timeout: {install, launch} s,
//        launch_steps: [steps] (its own dialogs on the way to that window), settle: ms, settle_shots: s,
//        dismiss: [{in: regex, alt|key}] (boxes answered while waiting, named in the notes), okrc: [codes], use: [steps]}
// Steps (interactive installs, and `after`): {wait: "regex", t}, {key: "Enter"|"Tab"|...}, {alt: "n"},
//        {type: "text"}, {click: [x, y]} (in: "regex": x, y in that window), {sleep: s}, {shot: name, page: true (the whole page, its notes too)}, {gone: "regex", t},
//        {press: "Enter", until: "regex", alt: "a", every: s, t} (the key, each `every` s, until no window matches)
// Writes OUTDIR/console.txt, OUTDIR/*.png (the compositor's readout) and OUTDIR/result.json:
//   {id, drop, install, launch, usable, first_error, times}
// Env: CHROME (default /usr/bin/chromium), APPSWEEP_GPU=1 (Vulkan instead of SwiftShader).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, appendFileSync, openSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Cdp, browserWsUrl } from './cdp.mjs';

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
  rmSync(`${outDir}/profile`, { recursive: true, force: true });
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

const port = 9471 + Math.floor(Math.random() * 2000);
const prof = `${outDir}/profile`;
rmSync(prof, { recursive: true, force: true });
const chrome = spawn(process.env.CHROME || '/usr/bin/chromium', [
  '--headless', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu',
  ...(process.env.APPSWEEP_GPU ? ['--use-angle=vulkan', '--enable-features=Vulkan'] : ['--use-angle=swiftshader-webgl', '--use-webgpu-adapter=swiftshader']),
  '--ozone-platform=headless', '--ozone-override-screen-size=1300,800', '--window-size=1300,800',
  process.env.SMOKE_SPKI ? `--ignore-certificate-errors-spki-list=${process.env.SMOKE_SPKI}` : '--ignore-certificate-errors',
  '--disable-hang-monitor', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank',
], { stdio: ['ignore', openSync(`${outDir}/chrome.out`, 'a'), openSync(`${outDir}/chrome.err`, 'a')] });
writeFileSync(`${outDir}/chrome.pid`, String(chrome.pid));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => done('killed by ' + sig));
for (const e of ['uncaughtException', 'unhandledRejection']) process.on(e, (x) => done('driver: ' + (x?.message ?? x)));

let ws = null;
for (let i = 0; i < 50 && !ws; i++) { await sleep(200); ws = await browserWsUrl(port); }
if (!ws) done('chromium did not start');
const cdp = await Cdp.connect(ws);
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
const lim = (pr, what, ms = 20000) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + what)), ms))]);
const s = (m, p) => lim(cdp.send(m, p, sessionId), m, m === 'Page.navigate' ? 300000 : 30000);
const ev = async (x) => (await s('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;

// the page's and its Workers' consoles; the error lines a row's first_error comes from
const errs = [];
let phase = 'boot';
const ERR = /threw|RuntimeError|unreachable|trap|gex-console-error|\berr:|wine: |Unhandled exception|page fault|abort|assert|not implemented|unimplemented function|Bad format|failed/i;
const QUIET = /memory reaches \d+ MiB for |\[sig\] pid \d+ takes a signal|\[wins\]|\[sweep\]|\[drop\]|native wasm32 module for|fixme:|\[sig\] pid \d+ sends signal|no function-tier unit/;
const line = (t) => {
  appendFileSync(`${outDir}/console.txt`, stamp() + ' ' + t + '\n');
  if (!QUIET.test(t) && ERR.test(t)) errs.push({ t: now(), phase, text: t.slice(0, 300) });
  if (t.startsWith('[drop] ')) drops.push(t);
};
const drops = [];
const workers = new Set();
cdp.on('Target.attachedToTarget', (e) => {
  workers.add(e.sessionId);
  cdp.send('Runtime.enable', {}, e.sessionId).catch(() => {});
  cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, e.sessionId).catch(() => {});
  cdp.send('Runtime.runIfWaitingForDebugger', {}, e.sessionId).catch(() => {});
});
cdp.on('Runtime.consoleAPICalled', (e) => line(e.args.map((a) => a.value ?? a.description).join(' ')));
cdp.on('Runtime.exceptionThrown', (e) => line('threw ' + (e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text)));
cdp.on('Inspector.targetCrashed', () => { line('[sweep] RENDERER CRASHED'); res.notes.push('renderer crashed'); done(); });
await s('Runtime.enable'); await s('Page.enable'); await s('Inspector.enable').catch(() => {});
await s('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await s('Page.navigate', { url });

// the compositor's windows: [{id, w, h, x, y, title}]
const wins = async () => {
  const d = await ev('(async()=>{const c=globalThis.__gexCompositor;return c?await c.describe({pixels:false}):null})()').catch(() => null);
  return (d?.list ?? []).map((l) => {
    const m = /^(\S+) .*? (\d+)x(\d+)@(-?\d+),(-?\d+) .*?"(.*)"$/.exec(l);
    return m ? { id: m[1], w: +m[2], h: +m[3], x: +m[4], y: +m[5], title: m[6] } : { id: l, title: '' };
  });
};
let lastList = '';
const watch = async () => { const l = (await wins()).map((w) => `${w.id} ${w.w}x${w.h}@${w.x},${w.y} "${w.title}"`).join('|'); if (l !== lastList) { lastList = l; line('[wins] ' + l); } };
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
const waitWin = async (re, secs, not = null) => {
  const r = new RegExp(re);
  let ls = now();
  for (const end = now() + secs; now() < end;) {
    await watch();
    if (now() - ls > 60) { ls = now(); await shot('wait'); }
    const all = await wins();
    const w = all.find((x) => r.test(x.title) && (!not || !not.has(x.id)) && (r.test('RC0') || !CRASH.test(x.title)));
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
const W = 1300, H = 713;
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
const cmd = async (text) => {
  const w = (await wins()).find((x) => x.id === cmdWin.id) ?? cmdWin;
  const own = (k) => typeof k === 'string' && k.split(':')[0] === String(w.id).split(':')[0];
  let at = null;
  const pts = [[Math.min(300, w.w / 2), Math.min(200, w.h / 2)], ...[[0.25, 0.3], [0.75, 0.3], [0.25, 0.8], [0.75, 0.8], [0.5, 0.97], [0.95, 0.5], [0.5, 0.02]].map(([fx, fy]) => [w.w * fx, w.h * fy])];
  for (const [dx, dy] of pts) {
    const x = Math.round(w.x + dx), y = Math.round(w.y + dy);
    if (own(await hit(x, y))) { at = [x, y]; break; }
  }
  if (at) await click(...at);
  else {
    // its taskbar button: the first after Start, the console being the first window the boot opens
    const bar = (await wins()).find((x) => x.w >= 400 && x.h <= 40 && x.y > 0 && !x.title);
    if (bar) { await click(bar.x + 160, bar.y + Math.floor(bar.h / 2)); await sleep(700); }
    const x = Math.round(w.x + pts[0][0]), y = Math.round(w.y + pts[0][1]);
    const up = own(await hit(x, y));
    log(`cmd window covered: its taskbar button clicked, ${up ? 'now on top' : 'still covered'}`);
    if (up) await click(x, y);
    await sleep(700); await shot('cmd-raised');
  }
  await sleep(700);
  // Esc first: what an earlier line left half typed (a window that took the keyboard in the middle of it) goes
  await key('Escape'); await sleep(200);
  await type(text); await sleep(200); await key('Enter');
};
const run = async (steps) => {
  for (const st of steps ?? []) {
    if (st.wait) { const w = await waitWin(st.wait, st.t ?? 120); if (!w) return `no window /${st.wait}/ in ${st.t ?? 120} s`; await sleep(1500); }
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
    else if (st.key) await key(st.key);
    else if (st.alt) await alt(st.alt);
    else if (st.tap) { const vk = { Alt: 18, Control: 17, Shift: 16 }[st.tap]; const code = st.tap + 'Left'; await kd('keyDown', st.tap, code, vk, 0); await sleep(120); await kd('keyUp', st.tap, code, vk, 0); log('tap ' + st.tap); }
    else if (st.type) await type(st.type);
    else if (st.click && st.in) { const r = new RegExp(st.in); const w = (await wins()).find((x) => r.test(x.title)); if (!w) return `no window /${st.in}/ to click in`; await click(w.x + st.click[0], w.y + st.click[1]); }
    else if (st.click) await click(...st.click);
    else if (st.sleep) await sleep(st.sleep * 1000);
    else if (st.shot) await shot(st.shot, st.page);
    await sleep(st.pause ?? 400);
  }
  return null;
};

// 1. boot: the desktop and its cmd window
cmdWin = await waitWin('cmd\\.exe$', 300);
// The windows there before the install: a timeout notes the others by title (a box's title says what stopped
// it, as Blender's "Unsupported CPU" did; its picture is the dialog-N-box.png the error-box wait crops).
const startWins = new Set((await wins()).map((w) => w.id));
const newWins = async () => { const t = (await wins()).filter((w) => !startWins.has(w.id) && w.title).map((w) => `"${w.title}" ${w.w}x${w.h}`); if (t.length) res.notes.push('windows at the timeout: ' + t.join(', ')); };
if (!cmdWin || !(await waitWin('^Desktop$', 60))) { res.first_error = firstErr(0) ?? 'the desktop did not come up in 300 s'; await shot('boot'); done('boot failed'); }
res.times.desktop = Math.round(now());
await sleep(3000);
const deskList = await wins(), desk = await shot('desktop');
// the file manager opens over cmd: close it (its title bar's close box), so a click on cmd reaches cmd
const fm = (await wins()).find((w) => w.title === 'Desktop');
if (fm) { await click(fm.x + fm.w - 14, fm.y + 15); await sleep(1500); }

// 2. the installer dragged in from the host
phase = 'drop';
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
const t2 = now();
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

// 4. launch the installed program: a new window
phase = 'launch';
if (!plan.launch) done();
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
if (!started) await cmd(`title launching & ${plan.launch}`);
// the program's own dialog on the way to its window (OBS's "Wine detected": Launch Anyway), answered as the plan says
if (plan.launch_steps) { const why = await run(plan.launch_steps); if (why) res.notes.push('launch steps: ' + why); }
const appRe = plan.title ?? '^(?!launching$|RC-?\\d+$|Desktop$|$).+';
let app = await waitWin(appRe, plan.timeout?.launch ?? 180, seen);
if (!app) { await shot('launch'); await newWins(); res.launch = bailed ? 'error box' : 'fail'; res.first_error = bailed ?? firstErr(t3) ?? `no window in ${plan.timeout?.launch ?? 180} s`; done(); }
res.launch = 'ok'; res.times.launch = +(now() - t3).toFixed(1); res.window = app.title;
// settle_shots: a picture every that many seconds of the settle, named by the seconds since the window came
// (settle-90s), to tell from them when a slow program's own screen (a game's main menu) is up
if (plan.settle_shots) {
  const t5 = now(), step = plan.settle_shots * 1000;
  for (let k = 1; k * step <= (plan.settle ?? 6000); k++) { await sleep(Math.max(0, t5 * 1000 + k * step - now() * 1000)); await shot(`settle-${Math.round(now() - t3 - res.times.launch)}s`); }
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
const still = (await wins()).some((w) => w.id === app.id);
// Drawn: the share of the program's window (on screen) whose pixels differ from the desktop as it was before
// anything ran, at its first picture; a window more than half undrawn, or one colour over 97% of it (a GL
// window still black or white), is not used, whatever changed after
const drawn = (() => {
  if (!desk || !a || desk.w !== a.w) return null;
  const x0 = Math.max(0, live.x), y0 = Math.max(0, live.y), x1 = Math.min(a.w, live.x + live.w), y1 = Math.min(a.h, live.y + live.h);
  // Only pixels where the desktop picture shows the wallpaper say whether the program drew: over another
  // window an unpainted one and a painted one can look the same (white over white). Too few such pixels: all count.
  const under = (x, y) => deskList.some((w) => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h);
  let walls = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!under(x, y)) walls++;
  const wallOnly = walls >= ((x1 - x0) * (y1 - y0)) / 10;
  let n = 0, tot = 0, all = 0; const hist = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * a.w + x) * 4; all++;
    const c = (a.b[i] << 16) | (a.b[i + 1] << 8) | a.b[i + 2]; hist.set(c, (hist.get(c) ?? 0) + 1);
    if (wallOnly && under(x, y)) continue;
    tot++;
    if (Math.abs(a.b[i] - desk.b[i]) + Math.abs(a.b[i + 1] - desk.b[i + 1]) + Math.abs(a.b[i + 2] - desk.b[i + 2]) > 24) n++;
  }
  return tot ? { frac: n / tot, over: tot / all, top: Math.max(...hist.values()) / all } : null;
})();
if (drawn) res.notes.push(`drawn: ${Math.round(drawn.frac * 100)}% of its ${live.w}x${live.h} window, measured over the ${Math.round(drawn.over * 100)}% of it on wallpaper in the desktop picture (most common colour ${Math.round(drawn.top * 100)}%)`);
const undrawn = drawn && (drawn.frac <= 0.5 || drawn.top > 0.97);
res.usable = !still ? 'window gone' : why ? why : undrawn ? `not drawn (${Math.round(drawn.frac * 100)}% of its window, ${Math.round(drawn.top * 100)}% one colour)` : changed === 0 ? 'no change' : 'ok';
res.changed_px = changed;
if (res.usable !== 'ok') res.first_error = firstErr(t4) ?? res.usable;
res.err_lines = errs.filter((e) => e.t >= t2).length; res.first_err_line = firstErr(t2);
// any later plan steps (a second interaction to look at by eye)
if (plan.after) await run(plan.after);
done();
