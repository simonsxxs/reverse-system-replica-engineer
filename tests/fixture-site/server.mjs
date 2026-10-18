#!/usr/bin/env node
/* server.mjs — 演练靶场伺服器（fixture 内置演示端点）
 * 直接运行：node server.mjs [端口]   → 打印 http://127.0.0.1:<端口>/（端口 0 = 随机）
 * 作为模块：import { createFixtureServer } from './server.mjs'（validate.mjs 复用同一伺服口径）
 *
 * 端点（全部演示假数据，无真实账号、无真实外呼）：
 *   POST /api/login.json   body {user,pass} → 200 {ok:true,user,token} + 响应头 Set-Token: demo-token-<随机>
 *                          （user/pass 任一为空 → 400 {ok:false,error:"missing credentials"}——校验失败路径）
 *   GET  /api/stats.json        → 基线 {visitors:128,tasks:6,health:41}
 *   GET  /api/stats.json?v=2    → 变体 {visitors:999,tasks:12,health:88,version:2}（接口变化演练场景）
 *   GET  /favicon.ico           → 204（无内容，避免采集误计 4xx）
 *   GET  /missing.css           → 恒 404（文件不存在，失败路径演练：broken.html 引用它）
 * 其余路径：fixture 目录内静态文件；/ = login.html；可选 replicaRoot 挂载 /replica/ 静态目录。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FIXTURE = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.md': 'text/markdown' };

/* 发送 JSON（统一 no-store，防采集吃到缓存旧响应） */
function sendJson(res, code, obj, extraHeaders = {}) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(obj));
}

/* 演示 API 路由（返回 true 表示已处理） */
function handleApi(req, res, pathname, query) {
  if (pathname === '/api/login.json' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return sendJson(res, 400, { ok: false, error: 'invalid json body' }); }
      if (!body || !body.user || !body.pass) return sendJson(res, 400, { ok: false, error: 'missing credentials' });
      // 演示 token：随机假值（真实 key/token 绝不入 fixture；响应体与响应头都会被采集器脱敏）
      const token = 'demo-token-' + crypto.randomBytes(6).toString('hex');
      sendJson(res, 200, { ok: true, user: String(body.user), token }, { 'set-token': token });
    });
    return true;
  }
  if (pathname === '/api/stats.json' && req.method === 'GET') {
    if (query.get('v') === '2') { sendJson(res, 200, { visitors: 999, tasks: 12, health: 88, version: 2 }); return true; }
    sendJson(res, 200, { visitors: 128, tasks: 6, health: 41 });
    return true;
  }
  if (pathname === '/favicon.ico') { res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); return true; }
  return false;
}

/* 创建伺服器：fixture 静态 + 演示 API（+ 可选 /replica/ 静态挂载，validate.mjs 使用） */
export function createFixtureServer({ replicaRoot } = {}) {
  const server = http.createServer((req, res) => {
    let pathname = '';
    let query = new URLSearchParams();
    try { const u = new URL(req.url, 'http://x'); pathname = decodeURIComponent(u.pathname); query = u.searchParams; } catch { res.writeHead(400); res.end('bad url'); return; }
    const isReplica = Boolean(replicaRoot) && pathname.startsWith('/replica/');
    if (handleApi(req, res, pathname, query)) return;
    const root = isReplica ? replicaRoot : FIXTURE;
    let rel = isReplica ? pathname.slice('/replica/'.length) : pathname;
    if (rel === '/' || rel === '') rel = 'login.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { 'cache-control': 'no-store' }); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return {
    server,
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve) => server.listen(port, host, () => resolve(`http://${host}:${server.address().port}`)));
    },
    close() { return new Promise((r) => server.close(r)); },
  };
}

/* 直接运行：node server.mjs [端口] —— 供 capture-page.mjs 对演练靶场实测使用 */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.argv[2]) || 0;
  const f = createFixtureServer();
  const base = await f.listen(port);
  console.log(`[fixture-server] 演练靶场就绪：${base}/  （Ctrl+C 停止；端点：POST /api/login.json、GET /api/stats.json[?v=2]、/missing.css 恒 404）`);
  process.on('SIGINT', async () => { await f.close(); process.exit(0); });
}
