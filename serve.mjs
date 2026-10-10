/*!
 * serve.mjs - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-D6495105
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = dirname(fileURLToPath(import.meta.url));
const root = resolve(project, 'dist');
/** Health payload reports the shipped identity; the version always follows package.json. */
const identity = JSON.parse(await readFile(resolve(project, 'package.json'), 'utf8')).version;
const port = Number(process.env.PORT || 8808);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
if (!existsSync(resolve(root, 'index.html'))) throw new Error('请先运行 npm.cmd ci 和 npm.cmd run build。');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end('Method not allowed'); return; }
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/api/health') { response.setHeader('Content-Type', 'application/json'); response.end(request.method === 'HEAD' ? '' : JSON.stringify({ ok: true, name: '交易训练室', version: identity })); return; }
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end('Not found'); return; }
    response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    response.end(request.method === 'HEAD' ? '' : await readFile(file));
  } catch { response.writeHead(404).end('Not found'); }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已使用，请检查现有服务或设置 PORT。` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`REPLAY_READY http://127.0.0.1:${port}/`));
