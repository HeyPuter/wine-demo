// The site from a host that is no help: no Content-Length on any answer (each body chunked), Range ignored
// (always 200 and the whole file), and text compressed on the fly (gzip: Content-Encoding). check.sh's nocl
// step: the page must start from such a host as from serve-h2.mjs. Over TLS with serve-h2.mjs's key
// (SERVE_CERT_DIR), HTTP/1.1 only. SERVE_LOG=FILE: one line per answer (seconds, status, bytes sent, path).
//   node serve-nocl.mjs ROOT PORT [HOST]
import https from 'node:https'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const [rootArg, port = '8000', host = '127.0.0.1'] = process.argv.slice(2); const root = path.resolve(rootArg);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' };
const squeeze = new Set(['.html', '.js', '.mjs', '.json', '.css', '.svg', '.txt', '.wasm']);
const LOG = process.env.SERVE_LOG ? fs.openSync(process.env.SERVE_LOG, 'a') : null; const T0 = Date.now();
const D = process.env.SERVE_CERT_DIR;
https.createServer({ key: fs.readFileSync(path.join(D, 'key.pem')), cert: fs.readFileSync(path.join(D, 'cert.pem')) }, (req, res) => {
  let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  let st = null; try { st = fs.statSync(p); } catch {}
  if (st?.isDirectory()) { p = path.join(p, 'index.html'); try { st = fs.statSync(p); } catch { st = null; } }
  const h = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-cache', 'Content-Type': types[path.extname(p)] || 'application/octet-stream' };
  if (!st?.isFile()) { res.writeHead(404, h).end(); return; }
  let sent = 0;
  if (LOG) res.on('finish', () => fs.writeSync(LOG, `${((Date.now() - T0) / 1000).toFixed(2)} ${res.statusCode} ${sent} ${req.url}${req.headers.range ? ' (asked ' + req.headers.range + ')' : ''}\n`));
  const gz = squeeze.has(path.extname(p)) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gz) h['Content-Encoding'] = 'gzip';
  res.writeHead(200, h);
  if (req.method === 'HEAD') { res.end(); return; }
  let s = fs.createReadStream(p);
  if (gz) s = s.pipe(zlib.createGzip({ level: 1 }));
  s.on('data', (b) => { sent += b.length; });
  s.pipe(res);
}).listen(+port, host, () => console.log(`https://${host}:${port}/ (no Content-Length, no Range, gzip)`));
