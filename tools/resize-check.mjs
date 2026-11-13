// resize-check.mjs URL OUTDIR: the site's desktop follows the browser window. Headless Chromium opens URL (the
// bare desktop, ?desktop=1), waits for Wine's desktop, then resizes its window: smaller, larger, maximised,
// restored and back. At each size, the checks:
//   - the compositor's canvas is laid out at the window's size, in CSS pixels as in its own (a canvas keeps the
//     CSS size it was first laid out at, and then the desktop is drawn squeezed or stretched into the old box);
//   - Wine's desktop window ("... - Wine Desktop") takes that size, and the taskbar spans it at its bottom;
//   - a click on the Start button, at the page point the taskbar is drawn at, opens the Start menu (a new
//     window just above the taskbar), and Escape closes it.
// Prints `ok ...` / `FAIL ...` lines and `resize-check: N failures`; exits 1 on any failure. OUTDIR gets
// console.txt and a page screenshot per size. Env: CHROME (default /usr/bin/chromium), SMOKE_SPKI (trust the
// server's key by its SPKI hash), DESKTOP_SECS (the wait for the desktop, default 300).
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { Cdp, browserWsUrl } from './cdp.mjs';

const [url, outDir = 'resize-check'] = process.argv.slice(2);
if (!url) { console.log('usage: node resize-check.mjs URL [OUTDIR]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const prof = `${outDir}/profile`;
rmSync(prof, { recursive: true, force: true });
const port = 9471 + Math.floor(Math.random() * 400);
const chrome = spawn(process.env.CHROME || '/usr/bin/chromium', [
  '--headless', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu',
  '--use-angle=swiftshader-webgl', '--use-webgpu-adapter=swiftshader',
  // a screen larger than the first window, so it can grow and be maximised
  '--ozone-platform=headless', '--ozone-override-screen-size=1920,1200', '--window-size=1300,800',
  process.env.SMOKE_SPKI ? `--ignore-certificate-errors-spki-list=${process.env.SMOKE_SPKI}` : '--ignore-certificate-errors',
  '--disable-hang-monitor', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank',
], { stdio: ['ignore', openSync(`${outDir}/chrome.out`, 'a'), openSync(`${outDir}/chrome.err`, 'a')] });
const T0 = Date.now();
const stamp = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(7);
const log = (m) => appendFileSync(`${outDir}/console.txt`, `${stamp()} ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const end = (why) => {
  if (why) { console.log(`FAIL ${why}`); fails++; }
  console.log(`resize-check: ${fails} failures`);
  try { chrome.kill('SIGKILL'); } catch {}
  rmSync(prof, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
};
for (const e of ['uncaughtException', 'unhandledRejection']) process.on(e, (x) => end(`driver: ${x?.message ?? x}`));
const check = (what, ok, detail = '') => { console.log(`${ok ? 'ok' : 'FAIL'} ${what}${ok || !detail ? '' : ` (${detail})`}`); log(`[check] ${ok ? 'ok' : 'FAIL'} ${what} ${detail}`); if (!ok) fails++; return ok; };

let ws = null;
for (let i = 0; i < 100 && !ws; i++) { await sleep(200); ws = await browserWsUrl(port); }
if (!ws) end('chromium did not start');
const cdp = await Cdp.connect(ws);
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
const lim = (pr, what, ms = 20000) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${what}`)), ms))]);
const s = (m, p) => lim(cdp.send(m, p, sessionId), m, m === 'Page.navigate' ? 300000 : 20000);
const ev = async (x) => (await s('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
cdp.on('Runtime.consoleAPICalled', (e, sid) => { if (sid === sessionId) log(e.args.map((a) => a.value ?? a.description).join(' ')); });
cdp.on('Inspector.targetCrashed', () => end('the renderer crashed'));
await s('Runtime.enable'); await s('Page.enable'); await s('Inspector.enable').catch(() => {});
await s('Page.navigate', { url });

// the compositor's windows: [{id, w, h, x, y, title}]
const wins = async () => {
  const d = await ev('(async()=>{const c=globalThis.__gexCompositor;return c?await c.describe({pixels:false}):null})()').catch(() => null);
  return (d?.list ?? []).map((l) => {
    const m = /^(\S+) .*? (\d+)x(\d+)@(-?\d+),(-?\d+) .*?"(.*)"$/.exec(l);
    return m ? { id: m[1], w: +m[2], h: +m[3], x: +m[4], y: +m[5], title: m[6] } : null;
  }).filter(Boolean);
};
const show = (l) => l.map((w) => `${w.w}x${w.h}@${w.x},${w.y} "${w.title}"`).join(' | ');
// Wine's desktop window and its taskbar (untitled, as wide as the desktop, under 40 high)
const desktop = (l) => {
  const d = l.find((w) => / - Wine Desktop$/.test(w.title));
  return { d, tb: d && l.find((w) => w.title === '' && w.w === d.w && w.h < 40 && w.y > 0) };
};
const limit = Date.now() + Number(process.env.DESKTOP_SECS ?? 300) * 1000;
let up = null;
while (Date.now() < limit && !(up = desktop(await wins())).tb) await sleep(1000);
if (!up?.tb) end(`no Wine desktop with a taskbar in ${process.env.DESKTOP_SECS ?? 300} s`);
log(`[wins] ${show(await wins())}`);
await sleep(5000);

const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId });
const page = () => ev(`(()=>{let b=null;for(const c of document.querySelectorAll('canvas')){const q=c.getBoundingClientRect();
  if(!b||q.width*q.height>b.css[0]*b.css[1])b={px:[c.width,c.height],at:[Math.round(q.x),Math.round(q.y)],css:[Math.round(q.width),Math.round(q.height)]}}
  return {inner:[innerWidth,innerHeight],canvas:b}})()`);
const sizes = [['smaller', { width: 1000, height: 640 }], ['larger', { width: 1700, height: 1000 }],
  ['maximised', { windowState: 'maximized' }], ['restored', { windowState: 'normal' }], ['back', { width: 1300, height: 800 }]];
for (const [tag, bounds] of sizes) {
  await cdp.send('Browser.setWindowBounds', { windowId, bounds });
  // the page's own resize waits 250 ms for the window to settle; then the desktop's
  let p = null, d = null;
  for (const t = Date.now() + 20000; Date.now() < t; await sleep(500)) {
    p = await page(); d = desktop(await wins());
    if (p?.canvas && d.d && d.tb && d.d.w === p.inner[0] && d.d.h === p.inner[1] && p.canvas.css[0] === p.inner[0]) break;
  }
  await sleep(1500);
  p = await page(); const l = await wins(); d = desktop(l);
  log(`[${tag}] ${JSON.stringify(p)} ${show(l)}`);
  const [iw, ih] = p.inner, c = p.canvas;
  check(`${tag}: the canvas is laid out at the window's ${iw}x${ih}`, c && c.css[0] === iw && c.css[1] === ih && c.px[0] === iw && c.px[1] === ih,
    c ? `CSS ${c.css.join('x')}, pixels ${c.px.join('x')}` : 'no canvas');
  check(`${tag}: Wine's desktop is ${iw}x${ih}`, d.d?.w === iw && d.d?.h === ih, d.d ? `${d.d.w}x${d.d.h}` : 'no desktop window');
  check(`${tag}: the taskbar spans the desktop at its bottom`, d.tb && d.tb.x === 0 && d.tb.w === iw && d.tb.y + d.tb.h === ih,
    d.tb ? `${d.tb.w}x${d.tb.h}@${d.tb.x},${d.tb.y}` : 'no taskbar');
  const shot = await s('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (shot) writeFileSync(`${outDir}/${tag}.png`, Buffer.from(shot.data, 'base64'));
  if (!d.tb || !c) continue;
  // the Start button, at the page point its pixels are drawn at
  const before = new Set(l.map((w) => w.id));
  const x = c.at[0] + (d.tb.x + 20) * c.css[0] / c.px[0], y = c.at[1] + (d.tb.y + d.tb.h / 2) * c.css[1] / c.px[1];
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) { await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await sleep(150); }
  let menu = null;
  for (const t = Date.now() + 10000; Date.now() < t && !menu; await sleep(500)) {
    menu = (await wins()).find((w) => !before.has(w.id) && w.x <= 20 && w.y + w.h <= d.tb.y + 2 && w.y + w.h >= d.tb.y - 8 && w.w > 40);
  }
  check(`${tag}: a click on Start at the page's ${Math.round(x)},${Math.round(y)} opens the Start menu above the taskbar`, !!menu,
    `new windows: ${show((await wins()).filter((w) => !before.has(w.id))) || 'none'}`);
  for (const type of ['keyDown', 'keyUp']) await s('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(1500);
}
end();
