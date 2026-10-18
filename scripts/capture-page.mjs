#!/usr/bin/env node
/* capture-page.mjs — 单页五件套采集骨架（动态轨通用工具）
 * 用法：node capture-page.mjs <URL> <输出目录> [--user <选择器>] [--pass <选择器>] [--submit <选择器>] [--wait <ms>]
 * 登录凭据走环境变量 CAPTURE_USER / CAPTURE_PASS（只在内存中使用，不回显、不落盘、不写日志）。
 * 产出（对齐 reference/02 五件套标准）：
 *   full.png 整页长图 ｜ dom.html 渲染后完整 DOM ｜ api/NNN-*.json 每请求一个 JSON（URL/方法/请求体/响应体/状态码）
 *   ｜ state/README-占位.md（交互状态需按 notes 清单人工补拍）｜ notes.md 骨架（接口清单自动列出）
 * 前置：先跑 preflight.mjs（tools/playwright + tools/browser.json）。exit 0=成功 1=失败。
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
const WAIT_MS = Number(flag('--wait')) || 30000;

if (!urlArg || !outArg) { console.error('用法：node capture-page.mjs <URL> <输出目录> [--user 选择器] [--pass 选择器] [--submit 选择器] [--wait 毫秒]\n凭据：环境变量 CAPTURE_USER / CAPTURE_PASS（配合 --user/--pass/--submit 使用）'); process.exit(2); }

if (!fs.existsSync(path.join(TOOLS, 'node_modules', 'playwright'))) { console.error('❌ 缺 tools/playwright：先运行 node scripts/preflight.mjs'); process.exit(1); }
let executablePath = null;
try { executablePath = JSON.parse(fs.readFileSync(path.join(TOOLS, 'browser.json'), 'utf8')).executablePath; } catch {}
if (!executablePath) { console.error('❌ 缺 tools/browser.json（浏览器内核未登记）：先运行 node scripts/preflight.mjs 自动探测/下载浏览器'); process.exit(1); }

const require2 = createRequire(path.join(TOOLS, 'package.json'));
const { chromium } = require2('playwright');

const OUT = path.resolve(outArg);
fs.mkdirSync(path.join(OUT, 'api'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'state'), { recursive: true });

const requests = [];
let seq = 0;
const safeName = (u) => { try { const p = new URL(u); return (p.hostname + p.pathname).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'root'; } catch { return 'req'; } };
const BODY_CAP = 256 * 1024;

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 2400 } }); // 五件套标准视口（reference/02 §一）
  page.on('response', async (r) => {
    const rec = { url: r.url(), method: r.request().method(), status: r.status(), resourceType: r.request().resourceType(), contentType: (r.headers()['content-type'] || '') };
    try { const pd = r.request().postData(); if (pd) rec.requestBody = pd.length > BODY_CAP ? { truncated: true, head: pd.slice(0, BODY_CAP) } : pd; } catch {}
    try {
      const ct = rec.contentType || '';
      if (/text|json|javascript|xml/.test(ct)) { const body = await r.text(); rec.responseBody = body.length > BODY_CAP ? { truncated: true, head: body.slice(0, BODY_CAP) } : body; }
      else rec.responseBody = { note: '非文本响应体不存（如需请用抓包工具）' };
    } catch (e) { rec.responseBody = { note: '响应体不可读：' + String(e.message || e).slice(0, 80) }; }
    requests.push(rec);
    if (/xhr|fetch/i.test(rec.resourceType)) {
      seq++;
      const file = path.join(OUT, 'api', String(seq).padStart(3, '0') + '-' + safeName(rec.url) + '.json');
      fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    }
  });

  await page.goto(urlArg, { waitUntil: 'domcontentloaded', timeout: WAIT_MS });

  /* 可选登录：凭据仅从环境变量读取 */
  const userSel = flag('--user'), passSel = flag('--pass'), submitSel = flag('--submit');
  if (userSel && passSel && submitSel) {
    if (!process.env.CAPTURE_USER || !process.env.CAPTURE_PASS) { console.error('❌ 提供了登录选择器但缺 CAPTURE_USER/CAPTURE_PASS 环境变量'); process.exit(2); }
    await page.fill(userSel, process.env.CAPTURE_USER);
    await page.fill(passSel, process.env.CAPTURE_PASS);
    await Promise.all([page.waitForLoadState('domcontentloaded'), page.click(submitSel)]);
  }

  /* TO-DO：此处按项目需要追加交互动作（点穿弹窗/滚动触发懒加载/翻页/筛选），
     每个交互状态在 state/ 下补拍截图与 DOM 子树（命名 state-<动作>.png）——见 reference/02 §一。 */

  await page.waitForLoadState('networkidle', { timeout: WAIT_MS }).catch(() => console.error('[WARN] networkidle 超时，按已收到的请求继续（长轮询/心跳站点属正常）'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'full.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, 'dom.html'), await page.content());
  fs.writeFileSync(path.join(OUT, 'state', 'README-占位.md'), '# 交互状态占位\n\n本文件是采集骨架占位：弹窗/抽屉/下拉/tab/校验态等交互状态需人工按 notes.md 交互清单补拍\n（每状态一张 state-*.png，DOM 变化的同步存子树 .html）。写操作到确认态即取消（授权分级见 reference/07）。\n');

  const xhrList = requests.filter((r) => /xhr|fetch/i.test(r.resourceType));
  fs.writeFileSync(path.join(OUT, 'notes.md'), `# notes.md（骨架，人工补全）

- URL：${urlArg}
- 采集时间：${new Date().toISOString()}
- 视口：1440×2400（headless）
- 请求总数：${requests.length}（其中 XHR/fetch ${xhrList.length} 个，已逐个落 api/）

## 页面作用
【TODO】

## 入口与跳转
【TODO：从哪进来、跳到哪去】

## 接口清单（自动列出，逐条补用途与复刻要点）
${xhrList.map((r) => `- \`${r.method} ${r.url}\` → ${r.status}`).join('\n') || '（无 XHR/fetch）'}

## 交互清单
【TODO：枚举可点元素逐个登记；「实测无 X」类结论须回对点击日志 result 与截图（error/timeout ≠ noop，见教训 L1/L2）】

## 复刻要点
【TODO】

## 脱敏提醒
抓包响应含真实 key/token/手机号 → 当场 ***REDACTED*** 并连带扫描历史产出（reference/07 §三）。
`);

  console.error(`＝＝＝ capture-page ✅：${path.join(OUT, 'full.png')} + dom.html + api/×${xhrList.length} + state/占位 + notes.md 骨架（请求总数 ${requests.length}）`);
  process.exitCode = 0;
} catch (e) {
  console.error(`❌ capture-page 失败：${String(e.message || e).slice(0, 300)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
