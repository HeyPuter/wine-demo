#!/usr/bin/env node
// Record the pre page (tools/pre-index.html, bin/pipeline.sh's pre/) for gexc eject: opens it in headless
// Chromium, waits for a window title, and writes OUT/wine32-session.json: how the page started Wine
// (`__windemo.session`), which processes ran and which native wasm modules loaded (each Worker's
// `[gex-record]` lines), the images loaded and when (`[gex] loaded`), wineboot's volatile registry keys,
// and the files the run read (`__windemo.opened()`, the kernel's read set), which the site's bundle split
// keeps in the bundle. `gexc eject OUT --out PROJECT` makes a project of it.
//
//   node tools/record.mjs URL OUT --bundle PATH [--title RE] [--timeout S] [--settle S] [--chrome PATH]
//                         [--console FILE] [--port N]
//
// --bundle PATH: the bundle the page fetched (bundle.tar), on this machine; the eject reads it from there.
// --title: a regular expression a toplevel's title must match (default "^Desktop$"); --settle: seconds to
// keep recording after it (5). --console FILE: every console line of the page and its Workers, timed.
// Env RECORD_PAGE_OUT=FILE: when no window comes, the page's whole output to FILE.

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Cdp, browserWsUrl } from './cdp.mjs';

const av = process.argv.slice(2);
const opt = (n, d) => { const i = av.indexOf(n); return i >= 0 ? av[i + 1] : d; };
const named = ['--port', '--title', '--timeout', '--bundle', '--settle', '--chrome', '--console'];
const [url, out] = av.filter((a, i) => !a.startsWith('--') && !named.includes(av[i - 1]));
if (!url || !out || !opt('--bundle', null)) {
  console.error('usage: node tools/record.mjs URL OUT --bundle PATH [--title RE] [--timeout S] [--settle S] [--chrome PATH] [--console FILE] [--port N]');
  process.exit(2);
}
const titleRe = new RegExp(opt('--title', '^Desktop$'));
const timeout = Number(opt('--timeout', '400')) * 1000;
const settle = Number(opt('--settle', '5')) * 1000;
const consoleFile = opt('--console', null);
const consoleT0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(out, { recursive: true });

const port = Number(opt('--port', '9711'));
const profile = mkdtempSync(join(tmpdir(), 'windemo-record-'));
const chrome = spawn(opt('--chrome', process.env.CHROME || '/usr/bin/chromium'), [
  '--headless', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-webgpu',
  '--use-angle=vulkan', '--enable-features=Vulkan', '--ozone-platform=headless',
  '--ozone-override-screen-size=1280,900', '--window-size=1280,900', '--disable-hang-monitor',
  '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { detached: true, stdio: 'ignore' });
const killChrome = () => {
  try { process.kill(-chrome.pid, 'SIGKILL'); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
// Chromium goes with this process however it ends.
spawn('bash', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 2; done; kill -KILL -- "-$2" 2>/dev/null; rm -rf -- "$3"',
  'windemo-record-watchdog', String(process.pid), String(chrome.pid), profile], { detached: true, stdio: 'ignore' }).unref();
process.on('exit', killChrome);
const done = (code) => { killChrome(); process.exit(code); };
for (const [sig, n] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) process.on(sig, () => done(128 + n));
process.on('uncaughtException', (e) => { console.error('record:', e); done(1); });
process.on('unhandledRejection', (e) => { console.error('record:', e); done(1); });

let ws = null;
for (let i = 0; i < 80 && !ws; i++) { ws = await browserWsUrl(port); if (!ws) await sleep(250); }
if (!ws) { console.error('record: Chromium did not start'); done(1); }
const browser = await Cdp.connect(ws);
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const { sessionId: page } = await browser.send('Target.attachToTarget', { targetId, flatten: true });

const processes = new Map(); // main image -> cmdline
const modules = new Map();   // path -> content key
const imagesLoaded = new Map();
const errors = [];
const volatileKeys = new Map();
const volatileKey = (t) => {
  const m = /^\[gex-record\] reg ((?:HKLM|HKCU)\\[^|]*)\|([^|]*)\|(\d*)\|([0-9a-f]*)\s*$/.exec(t);
  if (!m) return false;
  let vals = volatileKeys.get(m[1]);
  if (!vals) volatileKeys.set(m[1], (vals = {}));
  if (m[3]) vals[m[2]] = [Number(m[3]), m[4]];
  return true;
};
browser.on('Runtime.consoleAPICalled', (p) => {
  const raw = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
  if (consoleFile) appendFileSync(consoleFile, `${((Date.now() - consoleT0) / 1000).toFixed(1).padStart(7)} ${raw.trimEnd()}\n`);
  const t = raw.replace(/^\[gex-console-error\] /, '');
  let m;
  if ((m = /^\[gex-record\] process (.*?) :: (.*)$/.exec(t))) processes.set(m[1], m[2]);
  else if (volatileKey(t)) { /* kept */ }
  else if ((m = /^\[gex-record\] module (.*) (\S+)$/.exec(t))) modules.set(m[1], m[2]);
  else if ((m = /^\[gex\] loaded (.*?)(?: \((?:with its unit|no unit)\))?\s*$/.exec(t))) {
    if (!imagesLoaded.has(m[1])) imagesLoaded.set(m[1], Date.now());
  } else if (p.type === 'error') errors.push(raw.slice(0, 300));
});
// Every Worker (each guest process's) attached as it starts, its log switch set before it runs.
browser.on('Target.attachedToTarget', async (p) => {
  const s = p.sessionId;
  if (p.targetInfo?.type !== 'worker') await browser.send('Runtime.runIfWaitingForDebugger', {}, s).catch(() => {});
  await browser.send('Runtime.enable', {}, s).catch(() => {});
  await browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s).catch(() => {});
  await browser.send('Runtime.evaluate', { expression: "globalThis.GEX_LOG ??= 'record'" }, s).catch(() => {});
  await browser.send('Runtime.runIfWaitingForDebugger', {}, s).catch(() => {});
});
await browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, page);
await browser.send('Runtime.enable', {}, page);
await browser.send('Page.enable', {}, page);
const ev = async (e) => (await browser.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, page).catch(() => ({})))?.result?.value;
await browser.send('Page.navigate', { url }, page);

const t0 = Date.now();
let title = null;
while (Date.now() - t0 < timeout) {
  const d = await ev('(async () => { const c = globalThis.__gexCompositor; return c ? JSON.stringify(await c.describe({ pixels: false })) : null; })()');
  const titles = d ? JSON.parse(d)?.titles ?? [] : [];
  title = titles.find((x) => titleRe.test(x)) ?? null;
  if (title) break;
  const st = await ev('JSON.stringify({ phase: globalThis.__windemo?.phase, error: globalThis.__windemo?.error })');
  if (st && JSON.parse(st).phase === 'failed') { console.error(`record: the page failed: ${JSON.parse(st).error}`); done(1); }
  await sleep(500);
}
if (!title) {
  console.error(`record: no window titled /${titleRe.source}/ in ${timeout / 1000} s`);
  console.error(`  at ${await ev('location.href')}, phase ${await ev('globalThis.__windemo?.phase')}`);
  const said = String(await ev("globalThis.__windemo?.out ?? document.body?.innerText ?? ''"));
  if (process.env.RECORD_PAGE_OUT) writeFileSync(process.env.RECORD_PAGE_OUT, said);
  console.error(`  page says: ${said.slice(-1500)}`);
  for (const e of errors.slice(0, 8)) console.error(`  console error: ${e}`);
  done(1);
}
const atTitle = (Date.now() - t0) / 1000;
const readSet = async () => JSON.parse((await ev('globalThis.__windemo?.opened ? __windemo.opened().then((p) => JSON.stringify(p), (e) => JSON.stringify({ error: String(e) })) : "null"')) ?? 'null');
const openedTitle = await readSet();
const firstRead = new Map();
const noteRead = (paths, at) => { if (Array.isArray(paths)) for (const f of paths) if (!firstRead.has(f)) firstRead.set(f, at); };
noteRead(openedTitle, atTitle);
for (const end = Date.now() + settle; Date.now() < end;) {
  await sleep(Math.min(5000, end - Date.now()));
  const at = +((Date.now() - t0) / 1000).toFixed(1);
  noteRead(await readSet(), at);
  console.log(`record: ${at} s: ${firstRead.size} files read`);
}
const sess = JSON.parse((await ev('JSON.stringify(globalThis.__windemo?.session ?? null)')) ?? 'null');
if (!sess) { console.error('record: the page has no __windemo.session'); done(1); }
const pageUrl = await ev('location.href');
for (const line of String((await ev("globalThis.__windemo?.out ?? ''")) ?? '').split('\n')) volatileKey(line.trimEnd());
const opened = await readSet();
noteRead(opened, +((Date.now() - t0) / 1000).toFixed(1));
if (opened?.error) console.error(`record: no read set: ${opened.error}`);

const session = {
  format: 'gex-wine32-session',
  version: 1,
  url: pageUrl,
  title,
  title_seconds: atTitle,
  page: sess,
  bundle: resolve(opt('--bundle', null)),
  processes: [
    ...[...processes].map(([image, cmdline]) => ({ image, cmdline })),
    ...[...modules.keys()].filter((m) => /^wasmdll:.*\.exe$/i.test(m) && !processes.has(m.slice(8)))
      .map((m) => ({ image: m.slice(8), cmdline: null })),
  ],
  // No translated units ship: none recorded.
  units: [],
  unit_misses: [],
  uncovered: [],
  modules: [...modules].map(([path, content]) => ({ path, content })),
  files_read: Array.isArray(opened) ? opened : null,
  files_read_title: Array.isArray(openedTitle) ? openedTitle : null,
  files_read_at: firstRead.size ? Object.fromEntries(firstRead) : null,
  // (none seen: left out, as the eject keeps out of the bundle a read image no run loaded)
  images_loaded: imagesLoaded.size ? Object.fromEntries([...imagesLoaded].map(([path, at]) => [path, +((at - t0) / 1000).toFixed(2)])) : null,
  ...(volatileKeys.size ? { volatile_keys: Object.fromEntries(volatileKeys) } : {}),
};
writeFileSync(join(out, 'wine32-session.json'), `${JSON.stringify(session, null, 2)}\n`);
console.log(`${out}/wine32-session.json: "${title}" at ${atTitle.toFixed(1)} s; ${session.processes.length} processes, `
  + `${session.modules.length} wasm modules, ${Object.keys(session.images_loaded).length} images`
  + `${session.files_read ? `, ${session.files_read.length} files read` : ''}`
  + `${session.files_read_title ? ` (${session.files_read_title.length} by the title)` : ''}`);
done(0);
