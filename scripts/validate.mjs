#!/usr/bin/env node
/* validate.mjs — Skill 端到端自检：对内置演练靶场跑「采集→建造→审查」迷你复刻闭环。
 * 前置：先跑 preflight.mjs（需要 tools/ 里的 playwright 与浏览器内核；browser.json 缺失会直接报错指引）。
 * 产出：tests/validate-output/（capture 独立快照 collect/ + 截图/DOM/复刻页[自带重写版样式+脚本]/署名组件/报告）+ 控制台结论；exit 0=全部通过。
 * 断言覆盖：采集五件套抽样 / **捆绑采集器闭环自检（spawn capture-page.mjs：脱敏·独立快照·完成度状态机·幂等·接口变化·404 失败路径）** /
 *           复刻产物落位与重写合规（similarity.mjs <40%）/ 白标与数据渲染 /
 *           视觉冒烟（样式真生效）/ tab 行为 / 弹窗开+关双向 / 署名胶囊风格自适应 / 非豁免 4xx=5xx=0 / 0 pageerror。
 */
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(SKILL, 'tests', 'fixture-site');
const OUT = path.join(SKILL, 'tests', 'validate-output');
const TOOLS = path.join(SKILL, 'tools');
const CAPTURE = path.join(SKILL, 'scripts', 'capture-page.mjs');
const COLLECT = path.join(OUT, 'collect'); // 阶段 A 主采集快照（capture-page --out 显式落位）
const require2 = createRequire(path.join(TOOLS, 'package.json'));
const results = [];
const assert = (phase, name, ok, detail = '') => { results.push({ phase, name, ok, detail: String(detail).slice(0, 200) }); console.error(`[${ok ? 'PASS' : 'FAIL'}] ${phase}/${name} ${detail}`); return ok; };

/* 0. 前置检查 */
if (!fs.existsSync(path.join(TOOLS, 'node_modules', 'playwright'))) { console.error('❌ 缺 tools/playwright：先运行 node scripts/preflight.mjs'); process.exit(1); }
const browserJsonPath = path.join(TOOLS, 'browser.json');
if (!fs.existsSync(browserJsonPath)) { console.error('❌ 缺 tools/browser.json（浏览器内核未登记）：先运行 node scripts/preflight.mjs 自动探测/下载浏览器'); process.exit(1); }
const { chromium } = require2('playwright');
let executablePath;
try { executablePath = JSON.parse(fs.readFileSync(browserJsonPath, 'utf8')).executablePath; } catch { console.error('❌ tools/browser.json 解析失败：删除后重跑 node scripts/preflight.mjs'); process.exit(1); }
if (!executablePath) { console.error('❌ tools/browser.json 缺 executablePath：重跑 node scripts/preflight.mjs'); process.exit(1); }
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'replica', 'api'), { recursive: true });

/* 1. 静态服务：fixture（含演示 API：POST /api/login.json、/api/stats.json?v=2、/missing.css 恒 404）+ /replica/ = 复刻产物 */
const { createFixtureServer } = await import(pathToFileURL(path.join(FIXTURE, 'server.mjs')).href);
const fixtureServer = createFixtureServer({ replicaRoot: path.join(OUT, 'replica') });
const base = await fixtureServer.listen(0);

/* 2. 浏览器 */
const browser = await chromium.launch({ executablePath, headless: true });
const consoleErrors = [];
/* 非豁免 4xx/5xx 红线（豁免项逐条登记，等同 reference/04 口径） */
const EXEMPT_4XX = [/^\/favicon\.ico$/]; // 豁免登记：伺服器 favicon 返回 204；此豁免保留作防御（复刻侧目录无 favicon 时兜底）
const badResponses = [];

/* ── 阶段 A 工具函数 ── */
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function manifestOf(dir) {
  const m = {};
  (function rec(d) { for (const n of fs.readdirSync(d).sort()) { const full = path.join(d, n); const rel = path.relative(dir, full); if (fs.statSync(full).isDirectory()) rec(full); else m[rel.split(path.sep).join('/')] = sha256(full); } })(dir);
  return m;
}
/* capture-status.json 损坏/缺失 → 保守视为 skeleton（proposal 异常处理口径） */
function readCaptureStatus(dir) {
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'capture-status.json'), 'utf8')); return j && j.status ? j : { status: 'skeleton', degraded: true }; }
  catch { return { status: 'skeleton', degraded: true }; }
}
/* spawn 捆绑采集器（闭环自检：validate 验的就是 capture-page 本体）。
 * 必须用异步 spawn：fixture 伺服器跑在本进程里，spawnSync 会冻结事件循环导致子进程连不上伺服器（实测教训）。 */
function runCapture(url, outArgs, { login = true } = {}) {
  return new Promise((resolve) => {
    const args = [CAPTURE, url, ...outArgs];
    if (login) args.push('--user', '#user', '--pass', '#pass', '--submit', '#go');
    const child = spawn(process.execPath, args, { env: { ...process.env, CAPTURE_USER: 'demo', CAPTURE_PASS: 'demo123' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 180000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const outLine = stdout.split('\n').find((l) => l.startsWith('[capture-out] '));
      resolve({ code, outDir: outLine ? outLine.replace('[capture-out] ', '').trim() : null, stderr: stderr.slice(-400) });
    });
  });
}

/* 复刻产物：重写版样式（紧凑排版、声明重排——仅保留设计令牌与契约值）与重写版脚本 */
const CLONE_CSS = `/* 复刻版样式（结构性重写：紧凑排版+声明重排；设计令牌与契约值保留） */
body{margin:0;color:#333;background:#f4f3f9;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}
.card{max-width:420px;margin:20px auto;padding:20px;border-radius:12px;background:#fff;box-shadow:0 8px 30px rgba(30,20,80,.12)}
h1{margin:0 0 12px;font-size:18px;color:#6d5dfc}
label{display:block;margin:10px 0 4px;font-size:12px;color:#888}
input{box-sizing:border-box;width:100%;padding:9px 12px;border:1.5px solid #e2e0ef;border-radius:8px;font-size:14px}
.btn{padding:10px 16px;border:0;border-radius:8px;background:#6d5dfc;color:#fff;font-size:14px;cursor:pointer}
.nav{display:flex;gap:6px;padding:12px 20px;background:#fff;border-bottom:1px solid #eee}
.tab{padding:7px 14px;border:0;border-radius:8px;background:transparent;color:#666;font-size:13px;cursor:pointer}
.tab.active{background:#efeaff;color:#6d5dfc;font-weight:700}
.wrap{max-width:900px;margin:0 auto;padding:18px}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px}
.stat{flex:1;min-width:120px;padding:14px 18px;border-radius:10px;background:#fff}
.stat b{display:block;font-size:22px;color:#6d5dfc}
.stat span{font-size:12px;color:#999}
.pane{padding:16px;border-radius:10px;background:#fff}
.pane[hidden]{display:none}
.modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(20,15,50,.45)}
.modal[hidden]{display:none}
.modal .box{width:320px;padding:22px;border-radius:12px;background:#fff}
`;
const CLONE_JS = `/* 复刻版交互脚本（结构性重写：箭头函数+事件委托+查表渲染，与原实现不同构） */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

/* tab 切换：事件委托一次绑定（原实现为逐元素循环绑定） */
const nav = $('.nav');
if (nav) nav.addEventListener('click', function (ev) {
  const btn = ev.target.closest('[data-tab]');
  if (!btn) return;
  $$('.tab', nav).forEach((x) => x.classList.toggle('active', x === btn));
  $$('.pane').forEach((p) => { p.hidden = p.id !== 'pane-' + btn.dataset.tab; });
});

/* 弹窗开关：查表绑定 */
const modal = $('#modal');
[['#openModal', true], ['#closeModal', false]].forEach(([sel, open]) => {
  const b = $(sel);
  if (b && modal) b.addEventListener('click', () => { modal.hidden = !open; });
});

/* 统计渲染：键值对查表写入 */
fetch('api/stats.json')
  .then((r) => r.json())
  .then((data) => {
    Object.keys(data).forEach((k) => {
      const el = $('[data-stat="' + k + '"]');
      if (el) el.textContent = data[k];
    });
  })
  .catch(() => { /* 静默：数据缺失不阻塞页面 */ });
`;

try {
  /* ═══ 阶段 A · 采集（捆绑采集器闭环自检：spawn capture-page.mjs） ═══ */
  const cap1 = await runCapture(base + '/login.html', ['--out', COLLECT]);
  assert('采集', '捆绑采集器闭环自检（capture-page 采集登录流 exit∈{0,3}）', (cap1.code === 0 || cap1.code === 3) && cap1.outDir === COLLECT, `exit=${cap1.code} dir=${cap1.outDir || '?'} ${cap1.code === null ? cap1.stderr : ''}`);
  const cap1Status = readCaptureStatus(COLLECT);
  assert('采集', 'capture-status=骨架（占位产物不算 complete）', cap1Status.status === 'skeleton', `status=${cap1Status.status} reasons=${(cap1Status.reasons || []).slice(0, 2).join('；')}`);
  const apiFiles = fs.existsSync(path.join(COLLECT, 'api')) ? fs.readdirSync(path.join(COLLECT, 'api')).filter((f) => f.endsWith('.json')).map((f) => path.join(COLLECT, 'api', f)) : [];
  let parseBad = 0;
  const apiRecs = apiFiles.map((f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { parseBad++; return null; } }).filter(Boolean);
  assert('采集', '采集产物 api/*.json 全部可解析（脱敏不破坏 JSON 结构）', apiFiles.length > 0 && parseBad === 0, `${apiFiles.length} 个文件，解析失败 ${parseBad}`);
  const loginRec = apiRecs.find((r) => r.method === 'POST' && r.url.includes('/api/login.json'));
  assert('采集', '登录 POST 被捕获', !!loginRec, loginRec ? `status=${loginRec.status}` : '未找到 POST /api/login.json 记录');
  const reqBody = typeof loginRec?.requestBody === 'string' ? loginRec.requestBody : '';
  assert('采集', '登录凭据已脱敏（requestBody 无明文密码）', reqBody.includes('***REDACTED***') && !reqBody.includes('demo123'), reqBody.slice(0, 80));
  assert('采集', 'Set-Token 响应头捕获且脱敏', loginRec?.sensitiveHeaders?.['set-token'] === '***REDACTED***', JSON.stringify(loginRec?.sensitiveHeaders || {}));
  const respBody = typeof loginRec?.responseBody === 'string' ? loginRec.responseBody : '';
  assert('采集', '响应体假 token 已脱敏（无 demo-token 明文）', respBody.includes('***REDACTED***') && !respBody.includes('demo-token'), respBody.slice(0, 80));
  const statsRec = apiRecs.find((r) => r.url.includes('/api/stats.json'));
  const stats = statsRec && typeof statsRec.responseBody === 'string' ? JSON.parse(statsRec.responseBody) : {}; // 采集失败时保持 {}，让后续断言红而不崩
  assert('采集', '接口响应捕获', !!stats && Object.prototype.hasOwnProperty.call(stats, 'visitors'), JSON.stringify(stats));
  /* capture-status 保守降级：损坏/缺失 → skeleton */
  const badDir = path.join(OUT, 'tmp-bad-status');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'capture-status.json'), '{broken json!!');
  const degraded = readCaptureStatus(badDir).status === 'skeleton' && readCaptureStatus(path.join(OUT, 'no-such-dir')).status === 'skeleton';
  assert('采集', 'capture-status 损坏/缺失保守降级为 skeleton', degraded, '损坏文件与缺失目录均按 skeleton 处理');

  /* 幂等：二次采集进独立快照、首次证据逐字节不变 */
  const before = manifestOf(COLLECT);
  const cap2 = await runCapture(base + '/login.html', [path.join(OUT, 'collect')]);
  const after = manifestOf(COLLECT);
  const unchanged = Object.keys(before).length > 0 && JSON.stringify(before) === JSON.stringify(after);
  assert('采集', '重复采集幂等：首次快照逐字节不变', unchanged && (cap2.code === 0 || cap2.code === 3), `${Object.keys(before).length} 个文件 sha256 比对 ${unchanged ? '一致' : '不一致'}`);
  assert('采集', '重复采集进独立快照目录', !!cap2.outDir && cap2.outDir !== COLLECT && cap2.outDir.startsWith(OUT) && fs.existsSync(cap2.outDir), cap2.outDir || '?');

  /* 接口变化场景：入口带 ?api=v2 → 采集到变体端点，前后差异可检出 */
  const cap3 = await runCapture(base + '/login.html?api=v2', ['--out', path.join(OUT, 'collect-v2')]);
  const v2Dir = path.join(OUT, 'collect-v2', 'api');
  const v2Files = fs.existsSync(v2Dir) ? fs.readdirSync(v2Dir).filter((f) => f.endsWith('.json')).map((f) => path.join(v2Dir, f)) : [];
  let v2Rec = null;
  for (const f of v2Files) { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j.url.includes('/api/stats.json') && j.url.includes('v=2')) v2Rec = j; } catch {} }
  assert('采集', '接口变化场景：?api=v2 端点被捕获（URL 含版本参数）', !!v2Rec, v2Rec ? v2Rec.url : `未捕获（exit=${cap3.code}，api ${v2Files.length} 个）`);
  let v2Stats = null;
  try { v2Stats = v2Rec && typeof v2Rec.responseBody === 'string' ? JSON.parse(v2Rec.responseBody) : null; } catch {}
  assert('采集', '接口变化场景：变体响应与基线可区分', !!v2Stats && v2Stats.visitors !== stats.visitors && v2Stats.version === 2, `变体 visitors=${v2Stats?.visitors} vs 基线 ${stats?.visitors}`);

  /* 404 失败路径：broken.html 引用恒 404 的 missing.css → capture-status=partial */
  const cap4 = await runCapture(base + '/broken.html', ['--out', path.join(OUT, 'collect-broken')], { login: false });
  const brokenStatus = readCaptureStatus(path.join(OUT, 'collect-broken'));
  assert('采集', '404 失败路径计入完成度（partial 而非 complete）', brokenStatus.status === 'partial' && (cap4.code === 0 || cap4.code === 3), `status=${brokenStatus.status} exit=${cap4.code} reasons=${(brokenStatus.reasons || []).slice(0, 1).join('')}`);

  /* 采集动线（保留既有产物与断言：登录页/跳转/弹窗，弹窗补关向断言） */
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(base + '/login.html');
  await page.screenshot({ path: path.join(OUT, 'collect-login.png'), fullPage: true });
  const loginDom = await page.content();
  assert('采集', '登录页 DOM 存档', loginDom.includes('演练靶场 · 登录'));

  await page.fill('#user', 'demo');
  await page.fill('#pass', 'demo123');
  await page.click('#go');
  await page.waitForURL('**/dashboard.html');
  await page.waitForFunction(() => document.querySelector('[data-stat="visitors"]')?.textContent !== '…');
  await page.screenshot({ path: path.join(OUT, 'collect-dashboard.png'), fullPage: true });
  const dashDom = await page.content();
  assert('采集', '登录流跳转工作台', dashDom.includes('演练靶场 · 工作台'));

  await page.click('#openModal');
  await page.waitForSelector('#modal:not([hidden])');
  await page.screenshot({ path: path.join(OUT, 'collect-modal.png') });
  const modalDom = await page.$eval('#modal', el => el.outerHTML);
  assert('采集', '弹窗状态采集', modalDom.includes('详情弹窗'));
  await page.click('#closeModal');
  const modalClosed = await page.$eval('#modal', el => el.hidden);
  await page.screenshot({ path: path.join(OUT, 'collect-modal-closed.png') });
  assert('采集', '弹窗关闭（开+关双向闭环）', modalClosed === true, `closeModal 后 hidden=${modalClosed}`);

  /* ═══ 阶段 B · 建造（从采集物生成复刻页，非拷贝原文件；产物自带重写版样式与脚本） ═══
   * 假阳性消除（T7-1）：①渲染 DOM 里的动态统计值清回占位符——复刻页必须靠重新请求渲染，不得继承采集时点值；
   * ②复刻页接口产物用与采集时不同的值（+1 偏移）——审查阶段渲染值==新接口值≠采集值才证明真的重新请求并渲染。 */
  let replica = dashDom
    .replace(/<title>[^<]*<\/title>/, '<title>演练靶场 · 工作台【复刻】</title>')
    .replace('<head>', '<head>\n<meta name="replica" content="built-by-validate">')
    .replace(/<script src="app\.js"><\/script>/, '<script src="app-clone.js"></script>')
    .replace(/(<b data-stat="[^"]*">)[^<]*(<\/b>)/g, '$1…$2');
  fs.writeFileSync(path.join(OUT, 'replica', 'replica-dashboard.html'), replica);
  const statsReplica = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, typeof v === 'number' ? v + 1 : v]));
  fs.writeFileSync(path.join(OUT, 'replica', 'api', 'stats.json'), JSON.stringify(statsReplica, null, 2));
  fs.writeFileSync(path.join(OUT, 'replica', 'styles.css'), CLONE_CSS);
  fs.writeFileSync(path.join(OUT, 'replica', 'app-clone.js'), CLONE_JS);
  const built = fs.readFileSync(path.join(OUT, 'replica', 'replica-dashboard.html'), 'utf8');
  assert('建造', '复刻页生成（含白标改写）', built.includes('【复刻】') && built.includes('name="replica"'));
  assert('建造', '接口产物落位', fs.existsSync(path.join(OUT, 'replica', 'api', 'stats.json')));
  assert('建造', '采集时点动态值已清空（复刻页不继承采集渲染值）', /<b data-stat="visitors">…<\/b>/.test(built) && !/<b data-stat="visitors">[^<]*128/.test(built), 'data-stat 全部回占位符 …');
  assert('建造', '接口值与采集时点区分（+1 偏移防假阳性）', statsReplica.visitors === stats.visitors + 1 && statsReplica.visitors !== stats.visitors, `复刻接口 visitors=${statsReplica.visitors} vs 采集时点 ${stats.visitors}`);
  assert('建造', '样式与脚本产物落位（复刻页引用 app-clone.js）', fs.existsSync(path.join(OUT, 'replica', 'styles.css')) && fs.existsSync(path.join(OUT, 'replica', 'app-clone.js')) && built.includes('app-clone.js') && !built.includes('"app.js"'));

  /* 重写合规自证：建造产物 vs 原型，走 similarity.mjs 审查方口径 */
  const SIM = path.join(SKILL, 'scripts', 'similarity.mjs');
  const simRun = (repl, proto) => { try { return JSON.parse(execSync(`node ${JSON.stringify(SIM)} ${JSON.stringify(repl)} ${JSON.stringify(proto)} --json`, { encoding: 'utf8' })); } catch (e) { return { summary: { overallPct: 999, bigBlocks: 1 }, error: String(e.message || e).slice(0, 120) }; } };
  const simJs = simRun(path.join(OUT, 'replica', 'app-clone.js'), path.join(FIXTURE, 'app.js'));
  assert('建造', '重写合规·脚本（similarity <40% 且无 ≥7 行块）', simJs.summary.overallPct < 40 && simJs.summary.bigBlocks === 0, `${simJs.summary.overallPct}% / 大块 ${simJs.summary.bigBlocks}`);
  const simCss = simRun(path.join(OUT, 'replica', 'styles.css'), path.join(FIXTURE, 'styles.css'));
  assert('建造', '重写合规·样式（similarity <40%）', simCss.summary.overallPct < 40 && simCss.summary.bigBlocks === 0, `${simCss.summary.overallPct}% / 大块 ${simCss.summary.bigBlocks}`);

  /* ═══ 阶段 C · 审查 ═══ */
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page2.on('pageerror', () => consoleErrors.push('pageerror'));
  page2.on('response', (r) => {
    if (r.status() < 400) return;
    let pathname = r.url();
    try { pathname = new URL(r.url()).pathname; } catch {}
    if (EXEMPT_4XX.some((re) => re.test(pathname))) return; // 登记豁免项
    badResponses.push(`${r.status()} ${r.url()}`);
  });
  await page2.goto(base + '/replica/replica-dashboard.html');
  await page2.waitForFunction(() => document.querySelector('[data-stat="visitors"]')?.textContent !== '…');
  const title = await page2.title();
  assert('审查', '白标标题改写生效', title.includes('【复刻】'), title);
  const marker = await page2.$eval('meta[name="replica"]', el => el.content).catch(() => null);
  assert('审查', '复刻标记在位', marker === 'built-by-validate');
  const visitors = await page2.$eval('[data-stat="visitors"]', el => el.textContent);
  /* 假阳性消除后的判据（T7-1）：渲染值==新接口值 且 ≠ 采集时点值——证明复刻页真的重新请求并渲染 */
  assert('审查', '接口数据真实渲染', visitors === String(statsReplica.visitors) && statsReplica.visitors !== stats.visitors, `visitors=${visitors}（复刻接口值 ${statsReplica.visitors}；采集时点 ${stats.visitors}，未继承）`);
  const modalBtn = await page2.$('#openModal');
  assert('审查', '可点元素在位', !!modalBtn);
  /* 弹窗开+关双向（复刻页行为实测，T7-1）：打开→可见，关闭→隐藏。
   * 崩溃安全：绑定缺失时 closeModal 位于隐藏弹窗内会点击超时——短超时+catch 降级为读态，让断言干净 FAIL 而非中断整轮（破坏性验证实测教训）。 */
  await page2.click('#openModal').catch(() => {});
  const repModalShown = await page2.$eval('#modal', el => !el.hidden).catch(() => false);
  await page2.click('#closeModal', { timeout: 3000 }).catch(() => {});
  const repModalHidden = await page2.$eval('#modal', el => el.hidden).catch(() => false);
  assert('审查', '弹窗开+关双向（复刻页行为实测）', repModalShown && repModalHidden, `open→visible=${repModalShown} close→hidden=${repModalHidden}`);

  /* 视觉冒烟：关键元素背景为白色系（证明样式文件真实生效，而非裸透明渲染） */
  const statBg = await page2.$eval('.stat', el => getComputedStyle(el).backgroundColor);
  const m = statBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  const whiteish = !!m && Number(m[1]) >= 245 && Number(m[2]) >= 245 && Number(m[3]) >= 245 && (m[4] === undefined || Number(m[4]) > 0.9);
  assert('审查', '视觉冒烟：样式真生效（.stat 背景为白色系）', whiteish, statBg);

  /* tab 点击切换（行为实测，非仅元素在位） */
  await page2.click('[data-tab="tasks"]');
  const paneTasksShown = await page2.$eval('#pane-tasks', el => !el.hidden);
  const paneOverviewHidden = await page2.$eval('#pane-overview', el => el.hidden);
  assert('审查', 'tab 点击切换生效（任务页显示/总览隐藏）', paneTasksShown && paneOverviewHidden, `tasks=${paneTasksShown} overviewHidden=${paneOverviewHidden}`);
  const tabActive = await page2.$eval('[data-tab="tasks"]', el => el.classList.contains('active'));
  assert('审查', 'tab 激活态迁移', tabActive);
  await page2.click('[data-tab="overview"]'); // 复原到总览

  /* ═══ 署名组件注入（如用户要求署名；见 reference/08）+ 风格自适应断言 ═══ */
  const addSig = path.join(SKILL, 'scripts', 'add-signature.mjs');
  if (fs.existsSync(addSig)) {
    try { execSync(`${JSON.stringify(process.execPath)} ${JSON.stringify(addSig)} ${JSON.stringify(path.join(OUT, 'replica'))}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { console.error('[WARN] add-signature 注入失败：' + String(e.stderr || e.message).slice(0, 200)); }
    await page2.goto(base + '/replica/replica-dashboard.html', { waitUntil: 'load' });
    const pill = await page2.waitForSelector('#ui-signature-pill', { timeout: 5000 }).catch(() => null);
    assert('署名', '署名胶囊注入成功', !!pill);
    const dotColor = await page2.$eval('#ui-signature-pill .dot', el => getComputedStyle(el).backgroundColor).catch(() => 'missing');
    const hostAccent = await page2.$eval('#openModal', el => getComputedStyle(el).backgroundColor);
    assert('署名', '风格自适应：胶囊强调色=宿主按钮色', dotColor === hostAccent, `${dotColor} vs 宿主 ${hostAccent}`);
  } else {
    assert('署名', 'add-signature.mjs 存在', false, 'scripts/add-signature.mjs 缺失');
  }

  /* 网络红线与页面错误（覆盖签名注入后的二次加载） */
  assert('审查', '非豁免 4xx/5xx = 0', badResponses.length === 0, badResponses.join(' | ') || '无异常响应');
  assert('审查', '0 pageerror', consoleErrors.length === 0, consoleErrors.join(','));

  /* ═══ 汇总 ═══ */
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  fs.writeFileSync(path.join(OUT, 'validate-report.json'), JSON.stringify({ pass, fail, results }, null, 2));
  console.error(`\n＝＝＝ validate ${fail === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${pass}/${results.length}（产物在 tests/validate-output/）`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await browser.close();
  await fixtureServer.close();
}
