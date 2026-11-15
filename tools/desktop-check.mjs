// desktop-check.mjs URL OUTDIR: the desktop's shortcuts. Headless Chromium opens URL (the launcher), takes its
// Desktop tile and waits for Wine's desktop, then:
//   - every shortcut of tools/desktop-links.tsv and the Read me shows as an icon on the desktop (an icon column
//     at each one's place in the row the desktop lays them out in, by name);
//   - a shortcut to a program with no icon of its own and no icon location (the drops' dillo.exe, built with no
//     resources), made in the Desktop folder through the agent, shows up too: Wine's desktop once left such a
//     shortcut out, where Windows shows the default application icon.
// Prints `ok ...` / `FAIL ...` lines and `desktop-check: N failures`; exits 1 on any failure. OUTDIR gets
// console.txt and the desktop's pictures. Env: CHROME (default /usr/bin/chromium), SMOKE_SPKI (trust the server's
// key by its SPKI hash), DESKTOP_SECS (the wait for the desktop, default 300).
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Cdp, browserWsUrl } from './cdp.mjs';

const [url, outDir = 'desktop-check'] = process.argv.slice(2);
if (!url) { console.log('usage: node desktop-check.mjs URL [OUTDIR]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const prof = `${outDir}/profile`;
rmSync(prof, { recursive: true, force: true });
const port = 9471 + Math.floor(Math.random() * 400);
const chrome = spawn(process.env.CHROME || '/usr/bin/chromium', [
  '--headless', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu',
  '--use-angle=swiftshader-webgl', '--use-webgpu-adapter=swiftshader', '--ozone-platform=headless',
  '--ozone-override-screen-size=1300,800', '--window-size=1300,800',
  process.env.SMOKE_SPKI ? `--ignore-certificate-errors-spki-list=${process.env.SMOKE_SPKI}` : '--ignore-certificate-errors',
  '--disable-hang-monitor', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank',
], { stdio: ['ignore', openSync(`${outDir}/chrome.out`, 'a'), openSync(`${outDir}/chrome.err`, 'a')] });
const T0 = Date.now();
const log = (m) => appendFileSync(`${outDir}/console.txt`, `${((Date.now() - T0) / 1000).toFixed(1).padStart(7)} ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const end = (why) => {
  if (why) { console.log(`FAIL ${why}`); fails++; }
  console.log(`desktop-check: ${fails} failures`);
  try { chrome.kill('SIGKILL'); } catch {}
  // Chromium may still be writing its profile as it dies
  try { rmSync(prof, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  process.exit(fails ? 1 : 0);
};
for (const e of ['uncaughtException', 'unhandledRejection']) process.on(e, (x) => end(`driver: ${x?.message ?? x}`));
const check = (what, ok, detail = '') => { console.log(`${ok ? 'ok' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`); log(`[check] ${ok ? 'ok' : 'FAIL'} ${what} ${detail}`); if (!ok) fails++; return ok; };

let ws = null;
for (let i = 0; i < 100 && !ws; i++) { await sleep(200); ws = await browserWsUrl(port); }
if (!ws) end('chromium did not start');
const cdp = await Cdp.connect(ws);
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
const lim = (pr, what, ms = 30000) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${what}`)), ms))]);
const s = (m, p) => lim(cdp.send(m, p, sessionId), m, m === 'Page.navigate' ? 300000 : 30000);
const ev = async (x) => (await s('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
cdp.on('Runtime.consoleAPICalled', (e, sid) => { if (sid === sessionId) log(e.args.map((a) => a.value ?? a.description).join(' ')); });
cdp.on('Inspector.targetCrashed', () => end('the renderer crashed'));
await s('Runtime.enable'); await s('Page.enable'); await s('Inspector.enable').catch(() => {});
await s('Page.navigate', { url });

const wins = async () => {
  const d = await ev('(async()=>{const c=globalThis.__gexCompositor;return c?await c.describe({pixels:false}):null})()').catch(() => null);
  return (d?.list ?? []).map((l) => {
    const m = /^(\S+) .*? (\d+)x(\d+)@(-?\d+),(-?\d+) .*?"(.*)"$/.exec(l);
    return m ? { id: m[1], w: +m[2], h: +m[3], x: +m[4], y: +m[5], title: m[6] } : null;
  }).filter(Boolean);
};
const desktop = (l) => {
  const d = l.find((w) => / - Wine Desktop$/.test(w.title));
  return { d, tb: d && l.find((w) => w.title === '' && w.w === d.w && w.h < 40 && w.y > 0) };
};
// the composited screen, RGBA
const readout = async () => {
  const r = await ev('(async()=>{const c=globalThis.__gexCompositor;return c?.readoutBase64?await c.readoutBase64():null;})()').catch(() => null);
  return r?.b64 ? { w: r.w, h: r.h, b: Buffer.from(r.b64, 'base64') } : null;
};
const png = (img) => {
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) img.b.copy(raw, y * (img.w * 4 + 1) + 1, y * img.w * 4, (y + 1) * img.w * 4);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(img.w, 0); ih.writeUInt32BE(img.h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
// The desktop's icon columns along its top row: x ranges in the band under the top edge where some pixel is not
// the desktop's background colour (that of the band's first pixel), runs closer than `gap` joined.
const columns = (img, y0 = 4, y1 = 36, gap = 12) => {
  const at = (x, y) => img.b.readUInt32BE((y * img.w + x) * 4);
  const bg = at(img.w - 200, 300);
  const busy = [];
  for (let x = 0; x < img.w - 120; x++) { let n = 0; for (let y = y0; y < y1; y++) if (at(x, y) !== bg) n++; busy.push(n > 0); }
  const out = [];
  for (let x = 0; x < busy.length; x++) {
    if (!busy[x]) continue;
    const last = out[out.length - 1];
    if (last && x - last[1] <= gap) last[1] = x; else out.push([x, x]);
  }
  return out.filter(([a, b]) => b - a >= 16);
};

// the launcher's Desktop tile
await (async () => { for (let i = 0; i < 120; i++) { if (await ev("!!document.querySelector('#launcher .tile')").catch(() => false)) return; await sleep(1000); } })();
await ev("document.querySelector('#launcher .tile').click()");
const limit = Date.now() + Number(process.env.DESKTOP_SECS ?? 300) * 1000;
let up = null;
while (Date.now() < limit && !(up = desktop(await wins())).tb) await sleep(1000);
if (!up?.tb) end(`no Wine desktop with a taskbar in ${process.env.DESKTOP_SECS ?? 300} s`);
// the agent's own window list settles, and the desktop's icons are drawn as their files come
await sleep(30000);
log(`[wins] ${(await wins()).map((w) => `${w.w}x${w.h}@${w.x},${w.y} "${w.title}"`).join(' | ')}`);
const links = readFileSync(new URL('./desktop-links.tsv', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[0]);
const names = [...links, 'Read me'];
const a = await readout();
if (!a) end('no readout of the screen');
writeFileSync(`${outDir}/desktop.png`, png(a));
const before = columns(a);
check(`an icon on the desktop for each of ${names.length} (${names.join(', ')})`, before.length === names.length, `${before.length} icon columns at ${before.map(([x0, x1]) => `${x0}-${x1}`).join(' ')}`);

// a shortcut to dillo.exe with no icon location, made in the Desktop folder by WScript, through the agent
const id = `deskcheck-${Date.now().toString(36)}`;
// and, to tell that from the shortcuts not being made at all, one to it with an icon location (shell32's folder)
const vbs = ['Set sh = CreateObject("WScript.Shell")',
  'Set l = sh.CreateShortcut("C:\\users\\gex\\Desktop\\Zy With icon.lnk")', 'l.TargetPath = "C:\\Program Files\\Dillo\\dillo.exe"',
  'l.IconLocation = "C:\\windows\\system32\\shell32.dll,-4"', 'l.Save',
  'Set l = sh.CreateShortcut("C:\\users\\gex\\Desktop\\Zz No icon.lnk")', 'l.TargetPath = "C:\\Program Files\\Dillo\\dillo.exe"', 'l.Save'].join('\r\n') + '\r\n';
const job = [`id=${id}`, 'name=No icon', 'launch=wscript.exe //B C:\\windemo\\deskcheck.vbs'].join('\r\n') + '\r\n';
const dropped = await ev(`(async () => { const a = globalThis.__app; if (!a?.drop) return false;
  await a.drop([new File([${JSON.stringify(vbs)}], 'deskcheck.vbs')], { dir: '/pfx/drive_c/windemo' });
  await a.drop([new File([${JSON.stringify(job)}], '${id}.job')], { dir: '/pfx/drive_c/windemo/queue' }); return true; })()`);
if (!check('the shortcut job handed to the agent', dropped)) end();
let after = before, b = a;
for (let i = 0; i < 90 && after.length <= before.length; i++) { await sleep(2000); b = await readout(); if (b) after = columns(b); }
// both are made by one script: a little longer for the second to be drawn
await sleep(10000); b = await readout() ?? b; if (b) after = columns(b);
if (b) writeFileSync(`${outDir}/desktop-noicon.png`, png(b));
if (check('the shortcuts were made (the one with an icon location shows)', after.length > before.length, `${after.length} icon columns, was ${before.length}`))
  check('a shortcut to a program with no icon shows on the desktop', after.length === before.length + 2, `${after.length} icon columns, was ${before.length}`);
end();
