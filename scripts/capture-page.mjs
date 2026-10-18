#!/usr/bin/env node
/* capture-page.mjs — 单页五件套采集骨架（动态轨通用工具）
 * 用法：node capture-page.mjs <URL> <输出目录基名> [--user <选择器>] [--pass <选择器>] [--submit <选择器>] [--wait <ms>]
 *       可选：--out <精确目录>（显式指定，不加时间戳后缀；已存在非空目录拒绝）  --force（允许写入已存在非空目录）
 * 登录凭据走环境变量 CAPTURE_USER / CAPTURE_PASS（只在内存中使用，不回显、不落盘、不写日志）。
 * 产出（对齐 reference/02 五件套标准）：
 *   full.png 整页长图 ｜ dom.html 渲染后完整 DOM（文本节点+内联脚本已脱敏，标签结构保留）
 *   ｜ api/NNN-*.json 每请求一个 JSON（URL/方法/请求体/响应体/状态码/敏感头；请求失败也落盘并记 failure）
 *   ｜ state/README-占位.md（交互状态需按 notes 清单人工补拍）｜ notes.md 骨架（接口清单自动列出，失败状态列失败）
 *   ｜ capture-status.json（采集完成度状态机：complete/skeleton/partial/failed + 依据）
 *
 * v1.2 加固（change: harden-system-replica-evidence）：
 *   P1 写盘前统一脱敏：api/*.json、dom.html、notes、capture-status 在写盘前过 redact——模式表驱动，
 *      覆盖 JSON 敏感键值（password/api key/token/secret/authorization/user/account 等，引号键子串匹配）、
 *      JS 裸键赋值（复合标识符分词判定：secretToken 命中、tokenize 不误伤）、Bearer/Basic 凭据、
 *      手机号、邮箱、URL 查询串敏感参数、敏感响应头（set-token/cookie/authorization 等）。
 *      替换只发生在字符串值内部（dom.html 为 HTML 感知：只替换文本节点与内联脚本内容，保留标签结构与属性）。
 *      full.png 为截图无法文本脱敏——原文保真，人工复核（脱敏声明在 notes.md 逐产物写明）。
 *   P2 独立快照：默认输出 <目录基名>-<YYYYMMDD-HHmmss>（重跑永不覆盖历史证据）；--out 显式指定
 *      但目标已存在且非空 → exit 2 拒绝（提示 --force）。异步等待：networkidle 超时后继续等待在途
 *      XHR 至完成或上限（15s）；**并等全部响应保存（含响应体异步读取）落盘完成后才收口**生成 capture-status.json。
 *   P3 完成度状态机（capture-status.json）：
 *      failed   = 致命错误（页面打不开/截图或 DOM 落盘失败）
 *      partial  = 采集动作完成但存在失败信号（非 2xx/3xx 响应、请求失败[连接失败/中断]、在途 XHR 超限）
 *      skeleton = 采集动作成功但为骨架（state 占位未补拍 / notes 含 TODO——人工补齐前不算完成）
 *      complete = 五件套齐备且无占位、无 TODO、无失败信号（本脚本骨架产出至多 skeleton，补齐后人工核升）
 * 退出码：0=complete ｜ 3=skeleton/partial（采集动作成功，完成度未达 complete）｜ 1=failed ｜ 2=用法/输入错误
 * 前置：先跑 preflight.mjs（tools/playwright + tools/browser.json）。capture-status.json 损坏/缺失时，消费方应保守视为 skeleton。
 * 扩展点：登录后需多步交互（点穿/滚动/翻页）时，在本文件 TO-DO 标记处按项目需要追加动作后再落盘。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(SKILL, 'tools');
const [, , urlArg, outArg] = process.argv;
const flag = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const hasFlag = (name) => process.argv.includes(name);
const WAIT_MS = Number(flag('--wait')) || 30000;
const FORCE = hasFlag('--force');
const explicitOut = flag('--out');

if (!urlArg || (!outArg && !explicitOut)) {
  console.error('用法：node capture-page.mjs <URL> <输出目录基名> [--out 精确目录] [--force] [--user 选择器] [--pass 选择器] [--submit 选择器] [--wait 毫秒]\n凭据：环境变量 CAPTURE_USER / CAPTURE_PASS（配合 --user/--pass/--submit 使用）\n快照：默认输出 <基名>-<YYYYMMDD-HHmmss>；--out 显式指定（非空目录拒绝，需 --force）');
  process.exit(2);
}

if (!fs.existsSync(path.join(TOOLS, 'node_modules', 'playwright'))) { console.error('❌ 缺 tools/playwright：先运行 node scripts/preflight.mjs'); process.exit(1); }
let executablePath = null;
try { executablePath = JSON.parse(fs.readFileSync(path.join(TOOLS, 'browser.json'), 'utf8')).executablePath; } catch {}
if (!executablePath) { console.error('❌ 缺 tools/browser.json（浏览器内核未登记）：先运行 node scripts/preflight.mjs 自动探测/下载浏览器'); process.exit(1); }

/* ── P1 脱敏（模式表驱动；只替换字符串值内部内容，保证 JSON 可解析、HTML 结构保留） ── */
const REDACTED = '***REDACTED***';
const SENSITIVE_KEY = 'pass(?:word|wd)?|pwd|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|authorization|credential|session[_-]?id|sessionid|user(?:name)?|account|mobile|phone';
/* 敏感词段表（F2，v1.2.2）：复合标识符按驼峰/下划线/连字符/数字边界切段，任一段精确命中即视为敏感键。
 * 例：secretToken→[secret,Token]✓、authTokenValue→[auth,Token,Value]✓、api_key→[api,key]✓；
 * 而 tokenize/monkey/keyboard 等整段词不命中——既修复合标识符漏网，又不误伤词中含词的普通英文。 */
const SENSITIVE_WORDS = ['password', 'passwd', 'pwd', 'pass', 'apikey', 'key', 'token', 'secret', 'authorization', 'credential', 'session', 'sessionid', 'auth', 'user', 'username', 'account', 'mobile', 'phone'];
function isSensitiveIdentifier(ident) {
  const segs = ident
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')   // camelCase 切段
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')      // 字母/数字边界切段（token2→token+2）
    .split(/[\s_\-]+/)
    .filter(Boolean);
  return segs.some((s) => SENSITIVE_WORDS.includes(s.toLowerCase()));
}
const REDACT_PATTERNS = [
  // 1) JSON/JS 对象字面量：敏感键名的字符串值整体打码（保留键与引号结构 → JSON 仍可解析；引号定界键名，子串匹配即可）
  { name: '敏感键值对', re: new RegExp(`("(?:[^"\\\\]|\\\\.)*(?:${SENSITIVE_KEY})(?:[^"\\\\]|\\\\.)*"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*")`, 'gi'), rep: `$1"${REDACTED}"` },
  // 1b) JS 裸键赋值（无引号键）——F2 改分词判定：整标识符切段后任一段精确命中敏感词才打码（复合标识符
  //     secretToken/secretKey/authTokenValue/mySecret 均命中；tokenize 等普通单词不误伤），保留原引号风格
  { name: 'JS 裸键赋值', re: /([A-Za-z_$][\w$]*)(\s*[:=]\s*)(["'])((?:\\.|(?!\3)[^\\])*)\3/g, rep: (m, key, eq, q) => (isSensitiveIdentifier(key) ? key + eq + q + REDACTED + q : m) },
  // 2) Bearer/Basic 等行内凭据（任意文本形态）
  { name: '行内凭据', re: /\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, rep: `$1 ${REDACTED}` },
  // 3) 中国大陆手机号（前后非数字）
  { name: '手机号', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g, rep: REDACTED },
  // 4) 邮箱
  { name: '邮箱', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, rep: REDACTED },
  // 5) URL 查询串敏感参数（token/key/secret/password/sign/session/user 类）
  { name: '查询串敏感参数', re: /([?&][^=&\s]*(?:token|key|secret|password|passwd|sign|session|user)[^=&\s]*=)[^&\s"']+/gi, rep: `$1${REDACTED}` },
];
function redact(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const p of REDACT_PATTERNS) out = out.replace(p.re, p.rep);
  return out;
}
/* HTML 感知脱敏：内联 <script> 块内容整体过 redact；标签之间文本节点过 redact；
 * 标签与属性原样保留（结构与标签不改动）。替换值为纯文本，不会引入引号/尖括号。 */
function redactHtml(html) {
  let out = html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, open, body, close) => open + redact(body) + close);
  out = out.replace(/>([^<]+)</g, (m, text) => '>' + redact(text) + '<');
  return out;
}
/* 敏感响应头：值整体打码（无论内容） */
const SENSITIVE_HEADERS = /^(authorization|proxy-authorization|cookie|set-cookie|set-token|x-api-key|x-auth-token|api-key|api-token)$/i;

/* ── P2 独立快照目录解析 ── */
const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
let OUT;
if (explicitOut) OUT = path.resolve(explicitOut);
else OUT = path.resolve(`${outArg}-${stamp()}`);
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length > 0 && !FORCE) {
  console.error(`❌ 输出目录已存在且非空：${OUT}\n   独立快照原则不覆盖历史证据。换目录/省略 --out（自动加时间戳）另起快照；确要写入该目录请加 --force。`);
  process.exit(2);
}

const require2 = createRequire(path.join(TOOLS, 'package.json'));
const { chromium } = require2('playwright');

/* 可选登录选择器与凭据校验（提前到浏览器启动前，避免中途 exit 残留浏览器进程） */
const userSel = flag('--user'), passSel = flag('--pass'), submitSel = flag('--submit');
if (userSel && passSel && submitSel && (!process.env.CAPTURE_USER || !process.env.CAPTURE_PASS)) {
  console.error('❌ 提供了登录选择器但缺 CAPTURE_USER/CAPTURE_PASS 环境变量');
  process.exit(2);
}

fs.mkdirSync(path.join(OUT, 'api'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'state'), { recursive: true });

const requests = [];      // 全部响应记录（含响应体读取失败的登记）
let seq = 0;
let lastResponseAt = null;
const safeName = (u) => { try { const p = new URL(u); return (p.hostname + p.pathname).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'root'; } catch { return 'req'; } };
const BODY_CAP = 256 * 1024;
const writeApiRecord = (rec) => {
  seq++;
  const file = path.join(OUT, 'api', String(seq).padStart(3, '0') + '-' + safeName(rec.url) + '.json');
  // P1 双保险：序列化后再过一道 redact（对已脱敏字段为幂等）
  fs.writeFileSync(file, redact(JSON.stringify(rec, null, 2)));
};

/* 状态机收集器 */
const stateFlags = { screenshot: false, dom: false, fatal: null };
const inflight = new Set();     // 在途 XHR/fetch（请求发出未结束）
const pendingSaves = new Set(); // 响应记录的异步落盘任务（含响应体读取）——收口前必须等它清空

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 2400 } }); // 五件套标准视口（reference/02 §一）

  /* 在途 XHR 跟踪（P2 异步等待的数据源） */
  page.on('request', (r) => { if (/xhr|fetch/i.test(r.resourceType())) inflight.add(r); });
  page.on('requestfinished', (r) => inflight.delete(r));

  /* 响应记录：整个异步过程（读体+落盘）登记进 pendingSaves，收口前等它全部结束 */
  page.on('response', (r) => {
    const task = (async () => {
      lastResponseAt = new Date().toISOString();
      const hs = r.headers();
      const sensitiveHeaders = {};
      for (const [k, v] of Object.entries(hs)) if (SENSITIVE_HEADERS.test(k)) sensitiveHeaders[k.toLowerCase()] = REDACTED;
      /* P1 字段级脱敏：URL/请求体/响应体/错误信息在入 rec 前先过 redact（原始未转义文本，模式命中率最高） */
      const rec = { url: redact(r.url()), method: r.request().method(), status: r.status(), resourceType: r.request().resourceType(), contentType: (hs['content-type'] || '') };
      if (Object.keys(sensitiveHeaders).length) rec.sensitiveHeaders = sensitiveHeaders;
      try { const pd = r.request().postData(); if (pd) rec.requestBody = pd.length > BODY_CAP ? { truncated: true, head: redact(pd.slice(0, BODY_CAP)) } : redact(pd); } catch {}
      try {
        const ct = rec.contentType || '';
        if (/text|json|javascript|xml/.test(ct)) { const body = await r.text(); rec.responseBody = body.length > BODY_CAP ? { truncated: true, head: redact(body.slice(0, BODY_CAP)) } : redact(body); }
        else rec.responseBody = { note: '非文本响应体不存（如需请用抓包工具）' };
      } catch (e) { rec.responseBody = { note: '响应体不可读：' + redact(String(e.message || e).slice(0, 80)) }; } // 读体失败也登记在案
      requests.push(rec);
      if (/xhr|fetch/i.test(rec.resourceType)) writeApiRecord(rec);
    })().catch(() => {});
    pendingSaves.add(task);
    task.finally(() => pendingSaves.delete(task));
  });

  /* 请求失败（连接失败/中断/无响应）：URL+失败文本落 api/ 并入接口清单（状态列失败）。
   * 注意：requestfailed 事件回调的 r 是 Request 对象本身（非 Response），方法直接取。 */
  page.on('requestfailed', (r) => {
    inflight.delete(r);
    const rec = {
      url: redact(r.url()),
      method: r.method(),
      status: null,
      failure: redact(String(r.failure()?.errorText || 'unknown').slice(0, 120)),
      resourceType: r.resourceType(),
      contentType: '',
    };
    requests.push(rec);
    if (/xhr|fetch/i.test(rec.resourceType)) writeApiRecord(rec);
  });

  await page.goto(urlArg, { waitUntil: 'domcontentloaded', timeout: WAIT_MS });

  /* 可选登录：凭据仅从环境变量读取 */
  if (userSel && passSel && submitSel) {
    await page.fill(userSel, process.env.CAPTURE_USER);
    await page.fill(passSel, process.env.CAPTURE_PASS);
    await Promise.all([page.waitForLoadState('domcontentloaded'), page.click(submitSel)]);
  }

  /* TO-DO：此处按项目需要追加交互动作（点穿弹窗/滚动触发懒加载/翻页/筛选），
     每个交互状态在 state/ 下补拍截图与 DOM 子树（命名 state-<动作>.png）——见 reference/02 §一。 */

  /* P2 异步等待：networkidle 超时后继续等在途 XHR 至完成或上限 */
  let networkIdleTimedOut = false;
  await page.waitForLoadState('networkidle', { timeout: WAIT_MS }).catch(() => { networkIdleTimedOut = true; console.error('[WARN] networkidle 超时，继续等待在途 XHR（上限 15s）…'); });
  const inflightDeadline = Date.now() + 15000;
  while (inflight.size > 0 && Date.now() < inflightDeadline) await page.waitForTimeout(200);
  const inflightLeft = inflight.size;
  if (inflightLeft > 0) console.error(`[WARN] 仍有 ${inflightLeft} 个在途 XHR 未完成（达等待上限），按已收到请求落盘`);
  /* P2 收口条件：在途请求结束后，还要等全部响应保存任务（含异步读体）落盘完成 */
  const saveDeadline = Date.now() + 5000;
  while (pendingSaves.size > 0 && Date.now() < saveDeadline) {
    await Promise.allSettled([...pendingSaves]);
    if (pendingSaves.size > 0) await page.waitForTimeout(100);
  }
  await page.waitForTimeout(500);
  try { await page.screenshot({ path: path.join(OUT, 'full.png'), fullPage: true }); stateFlags.screenshot = true; } catch (e) { stateFlags.fatal = '截图失败：' + String(e.message || e).slice(0, 120); }
  try { fs.writeFileSync(path.join(OUT, 'dom.html'), redactHtml(await page.content())); stateFlags.dom = true; } catch (e) { stateFlags.fatal = stateFlags.fatal || ('DOM 存档失败：' + String(e.message || e).slice(0, 120)); }
  fs.writeFileSync(path.join(OUT, 'state', 'README-占位.md'), '# 交互状态占位\n\n本文件是采集骨架占位：弹窗/抽屉/下拉/tab/校验态等交互状态需人工按 notes.md 交互清单补拍\n（每状态一张 state-*.png，DOM 变化的同步存子树 .html）。写操作到确认态即取消（授权分级见 reference/07）。\n');

  const xhrList = requests.filter((r) => /xhr|fetch/i.test(r.resourceType));
  const statusText = (r) => (r.failure ? `失败(${r.failure})` : String(r.status));
  const notesText = `# notes.md（骨架，人工补全）

- URL：${urlArg}
- 采集时间：${new Date().toISOString()}
- 最后响应时间：${lastResponseAt || '（无响应记录）'}
- 视口：1440×2400（headless）
- 请求总数：${requests.length}（其中 XHR/fetch ${xhrList.length} 个，已逐个落 api/，含失败请求）

## 页面作用
【TODO】

## 入口与跳转
【TODO：从哪进来、跳到哪去】

## 接口清单（自动列出，逐条补用途与复刻要点；失败请求状态列失败）
${xhrList.map((r) => `- \`${r.method} ${r.url}\` → ${statusText(r)}`).join('\n') || '（无 XHR/fetch）'}

## 交互清单
【TODO：枚举可点元素逐个登记；「实测无 X」类结论须回对点击日志 result 与截图（error/timeout ≠ noop，见教训 L1/L2）】

## 复刻要点
【TODO】

## 脱敏说明（逐产物口径）
- 已自动脱敏：api/*.json、dom.html（文本节点+内联脚本，标签结构保留）、notes.md、capture-status.json——敏感键值/Bearer/手机号/邮箱/URL 敏感参数 → ${REDACTED}
- 原文保真：full.png 为截图，无法文本脱敏——**人工复核**（如页面渲染了真实 key/token/手机号，按 reference/07 §三 连带处理）
- 自动脱敏不免除人工复核义务；发现漏网敏感值当场修复并连带扫描历史产出。
`;
  fs.writeFileSync(path.join(OUT, 'notes.md'), redact(notesText));

  /* ── P3 完成度状态机（在全部保存任务结束后生成） ── */
  const nonOk = requests.filter((r) => !r.failure && !(r.status >= 200 && r.status < 400)).map((r) => ({ method: r.method, status: r.status, url: redact(r.url) }));
  /* 请求失败计分：net::ERR_ABORTED 多为导航取消噪声（仍落盘留证），其余失败计入 partial 判定 */
  const failedReqs = requests.filter((r) => r.failure);
  const blockingFailures = failedReqs.filter((r) => !/ERR_ABORTED/i.test(r.failure || ''));
  const reasons = [];
  let status;
  if (stateFlags.fatal) {
    status = 'failed';
    reasons.push(stateFlags.fatal);
  } else {
    if (nonOk.length) reasons.push(`非 2xx/3xx 响应 ${nonOk.length} 条：` + nonOk.slice(0, 8).map((n) => `${n.method} ${n.url} → ${n.status}`).join('；') + (nonOk.length > 8 ? `（等共 ${nonOk.length} 条）` : ''));
    if (blockingFailures.length) reasons.push(`请求失败 ${blockingFailures.length} 条（连接失败/中断）：` + blockingFailures.slice(0, 5).map((n) => `${n.method} ${n.url} → ${n.failure}`).join('；') + (blockingFailures.length > 5 ? `（等共 ${blockingFailures.length} 条）` : ''));
    if (failedReqs.length > blockingFailures.length) reasons.push(`另有 ${failedReqs.length - blockingFailures.length} 条 ERR_ABORTED（导航取消噪声，已落盘留证，不计入失败信号）`);
    if (inflightLeft > 0) reasons.push(`等待上限内仍有 ${inflightLeft} 个在途 XHR 未完成（响应可能不完整）`);
    if (networkIdleTimedOut && inflightLeft === 0) reasons.push('networkidle 超时（在途 XHR 已在延长期内收齐，长轮询/心跳站点属正常）');
    if (fs.existsSync(path.join(OUT, 'state', 'README-占位.md'))) reasons.push('交互状态为骨架占位（state/README-占位.md），未人工补拍');
    if (/【TODO/.test(notesText)) reasons.push('notes.md 仍为骨架（含 TODO 待补项）');
    status = nonOk.length || blockingFailures.length || inflightLeft > 0 ? 'partial' : 'skeleton';
  }
  const statusDoc = {
    status,
    capturedAt: new Date().toISOString(),
    lastResponseAt,
    url: urlArg,
    requests: requests.length,
    xhrCaptured: xhrList.length,
    nonOkCount: nonOk.length,
    failedRequests: failedReqs.length,
    reasons,
    checklist: { 'full.png（原文保真，人工复核）': stateFlags.screenshot, 'dom.html（已脱敏）': stateFlags.dom, 'api/*.json（已脱敏，含失败请求）': xhrList.length, 'state 占位（须人工补拍）': true, 'notes 骨架（须人工补全）': true },
    semantics: 'complete=五件套齐备无占位无TODO无失败信号 ｜ skeleton=骨架（占位/TODO 未补） ｜ partial=有失败信号（非2xx/3xx、请求失败、在途超限） ｜ failed=致命错误；本工具骨架产出至多 skeleton',
  };
  fs.writeFileSync(path.join(OUT, 'capture-status.json'), redact(JSON.stringify(statusDoc, null, 2)));

  console.log(`[capture-out] ${OUT}`);
  console.error(`＝＝＝ capture-page ${status === 'failed' ? '❌' : '✅'}（status=${status}）：${path.join(OUT, 'full.png')} + dom.html + api/×${xhrList.length} + state/占位 + notes.md 骨架 + capture-status.json（请求总数 ${requests.length}，非 2xx/3xx ${nonOk.length}，请求失败 ${failedReqs.length}）`);
  process.exitCode = status === 'failed' ? 1 : (status === 'complete' ? 0 : 3);
} catch (e) {
  console.error(`❌ capture-page 失败：${String(e.message || e).slice(0, 300)}`);
  /* 失败也要落状态文件（目录若已建好），供消费方保守判定 */
  try {
    fs.writeFileSync(path.join(OUT, 'capture-status.json'), JSON.stringify({ status: 'failed', capturedAt: new Date().toISOString(), lastResponseAt, url: redact(urlArg), reasons: [String(e.message || e).slice(0, 300)] }, null, 2));
    console.log(`[capture-out] ${OUT}`);
  } catch {}
  process.exitCode = 1;
} finally {
  await browser.close();
}
