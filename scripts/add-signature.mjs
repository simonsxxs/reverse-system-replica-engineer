#!/usr/bin/env node
/* add-signature.mjs — 署名与社区组件注入 v2.4（风格自适应）
 * 用法：node add-signature.mjs <项目目录（建议 frontend 交付目录）> [--selftest]
 *
 * 行为（幂等，重复运行安全）：
 *   1. README.md 末尾追加标准署名段（含标记则跳过；无 README 则新建）；
 *   2. 目录下全部 .html 在 </body> 前注入 signature.js/css 引用（含标记则跳过）；
 *   3. 生成 static/signature.js + static/signature.css：
 *      右下角胶囊「加入社区」+ 悬停展开弹层（微信二维码 data URI + 作者 + 链接）；
 *      运行时风格自适应：overrides → 宿主 CSS 变量（--accent/--primary/--primary-color、
 *      --text/--foreground、--bg/--background）→ 既有按钮实色/正文色/页面背景（亮度判定深浅色）
 *      → 中性毛玻璃默认；圆角与字体沿用宿主；任何异常静默失败，绝不挡内容。
 *   4. --selftest：对内置演练靶场（tests/fixture-site）副本注入两遍，
 *      断言注入点存在、二次注入全部跳过、文件内容不变，结束后清理临时目录。
 *
 * 合规口径见 reference/08：原创作品默认注入；第三方系统复刻默认不注入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIG_MARKER = 'signature:v2.4';
const README_MARKER = 'signature-block:v2.4';
const SKIP_DIRS = new Set(['node_modules', '.git', 'tools', 'validate-output']);

const args = process.argv.slice(2);
const SELFTEST = args.includes('--selftest');
const targetArg = args.find((a, i) => !a.startsWith('-') && !(args[i - 1] === '--selftest'));
const target = targetArg ? path.resolve(targetArg) : path.join(SKILL, 'tests', 'validate-output');

/* ── 配置与素材 ── */
function loadConfig() {
  const cfgPath = path.join(SKILL, 'assets', 'signature.json');
  const qrPath = path.join(SKILL, 'assets', 'wechat-qr.b64');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const qr = fs.readFileSync(qrPath, 'utf8').replace(/\s+/g, '');
  if (!qr.startsWith('iVBOR')) { console.error('❌ assets/wechat-qr.b64 不是 PNG base64 素材'); process.exit(2); }
  return {
    author: cfg.author || '',
    wechat: cfg.wechat || '',
    github: cfg.github || '',
    gitee: cfg.gitee || '',
    pillText: cfg.pillText || '加入社区',
    overrides: cfg.overrides || {},
    qrDataUri: 'data:image/png;base64,' + qr,
  };
}

/* ── README 署名段 ── */
function readmeBlock(cfg) {
  return [
    `<!-- ${README_MARKER}（本段由 system-1to1-replica/scripts/add-signature.mjs 管理，勿手改） -->`,
    '',
    '---',
    '',
    '## 关于作者',
    '',
    `- **作者**：${cfg.author}`,
    `- **微信交流群**：${cfg.wechat}`,
    `- **GitHub**：<${cfg.github}>`,
    `- **Gitee**：<${cfg.gitee}>`,
  ].join('\n');
}

/* ── static/signature.css（结构样式；颜色走 --sig-* 变量，由 signature.js 运行时注入） ── */
function signatureCss() {
  return `/*! signature.css v2.4 — 署名组件结构样式（配色变量由 signature.js 按宿主风格自适应注入） */
#ui-signature-pill{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;background:var(--sig-bg,rgba(255,255,255,.92));border:1px solid var(--sig-border,rgba(0,0,0,.08));box-shadow:0 2px 10px rgba(0,0,0,.10);cursor:pointer;font:12px/1.4 var(--sig-font,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif);color:var(--sig-fg,rgba(0,0,0,.72));user-select:none;-webkit-backdrop-filter:blur(6px) saturate(1.2);backdrop-filter:blur(6px) saturate(1.2)}
#ui-signature-pill .dot{width:7px;height:7px;border-radius:50%;background:var(--sig-accent,#07c160)}
#ui-signature-pill:hover{border-color:var(--sig-accent)}
#ui-signature-card{position:fixed;right:16px;bottom:56px;z-index:2147483001;width:212px;padding:10px 12px 8px;border-radius:var(--sig-card-radius,10px);background:var(--sig-bg,rgba(255,255,255,.92));border:1px solid var(--sig-border,rgba(0,0,0,.06));box-shadow:0 6px 22px rgba(0,0,0,.14);font:11px/1.6 var(--sig-font,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif);color:var(--sig-fg,rgba(0,0,0,.75));text-align:center;display:none;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
#ui-signature-card.open{display:block}
#ui-signature-card .qr{width:140px;height:140px;display:block;margin:0 auto 6px;border-radius:6px}
#ui-signature-card .wx{font-size:12px;font-weight:600}
#ui-signature-card .copy{margin-left:6px;padding:1px 7px;border-radius:6px;border:1px solid var(--sig-border,rgba(0,0,0,.12));background:transparent;color:var(--sig-fg,rgba(0,0,0,.75));cursor:pointer;font-size:10px}
#ui-signature-card .meta{margin-top:4px;font-size:10px;opacity:.9}
#ui-signature-card .meta a{color:var(--sig-accent,#07c160);text-decoration:none}
`;
}

/* ── static/signature.js（运行时探测宿主令牌并落 --sig-* 变量；静默失败） ── */
function signatureJs(cfg) {
  const cfgJson = JSON.stringify({ author: cfg.author, wechat: cfg.wechat, github: cfg.github, gitee: cfg.gitee, pillText: cfg.pillText, overrides: cfg.overrides, qrDataUri: cfg.qrDataUri });
  return `/*! signature.js v2.4 — 界面署名与社区组件（风格自适应）｜组件模式源自 software-decard ui-signature，静默失败不挡内容 */
(function () {
  'use strict';
  if (document.getElementById('ui-signature-pill')) return;
  var CFG = ${cfgJson};
  try { main(); } catch (e) { /* 静默失败，绝不影响页面 */ }

  function main() {
    var T = probe();
    var pill = document.createElement('div');
    pill.id = 'ui-signature-pill';
    pill.innerHTML = '<span class="dot"></span><span class="txt"></span>';
    pill.querySelector('.txt').textContent = CFG.pillText || '加入社区';
    applyVars(pill, T);

    var card = document.createElement('div');
    card.id = 'ui-signature-card';
    card.innerHTML = '<img class="qr" alt="wechat-qr"><div class="wxline"><span class="wx"></span><button type="button" class="copy">点击复制</button></div><div class="meta"></div>';
    card.querySelector('.wx').textContent = '微信交流群：' + (CFG.wechat || '');
    card.querySelector('img').src = CFG.qrDataUri;
    var meta = card.querySelector('.meta');
    if (CFG.author) { meta.appendChild(document.createTextNode(CFG.author)); meta.appendChild(document.createElement('br')); }
    [['github', 'GitHub'], ['gitee', 'Gitee']].forEach(function (pair) {
      if (!CFG[pair[0]]) return;
      var a = document.createElement('a');
      a.href = CFG[pair[0]]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = pair[1];
      meta.appendChild(a); meta.appendChild(document.createTextNode('  '));
    });
    applyVars(card, T);

    var hideTimer = null;
    function show() { clearTimeout(hideTimer); card.classList.add('open'); }
    function hide() { hideTimer = setTimeout(function () { card.classList.remove('open'); }, 200); }
    pill.addEventListener('mouseenter', show);
    pill.addEventListener('mouseleave', hide);
    pill.addEventListener('click', function () { card.classList.contains('open') ? hide() : show(); });
    card.addEventListener('mouseenter', show);
    card.addEventListener('mouseleave', hide);

    card.querySelector('.copy').addEventListener('click', function (e) {
      e.stopPropagation();
      var btn = e.currentTarget;
      var done = function () { btn.textContent = '已复制'; setTimeout(function () { btn.textContent = '点击复制'; }, 1500); };
      var id = CFG.wechat || '';
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(id).then(done).catch(function () { fallbackCopy(id, done); });
      else fallbackCopy(id, done);
    });

    (document.body || document.documentElement).appendChild(pill);
    (document.body || document.documentElement).appendChild(card);
  }

  /* 风格探测：overrides → 宿主 CSS 变量 → 既有按钮实色/正文色/页面背景（亮度判定） → 中性毛玻璃默认 */
  function probe() {
    var o = CFG.overrides || {};
    var rootStyle = null;
    try { rootStyle = getComputedStyle(document.documentElement); } catch (e) {}
    function v(name) { try { var val = rootStyle && rootStyle.getPropertyValue(name); return val && val.trim() ? val.trim() : null; } catch (e) { return null; } }
    function rgb(s) { if (!s) return null; var m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; var p = m[1].split(','); return { r: parseFloat(p[0]), g: parseFloat(p[1]), b: parseFloat(p[2]), a: p.length > 3 ? parseFloat(p[3]) : 1 }; }
    function neutral(c) { if (!c || c.a === 0) return true; var mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return (mx - mn) <= 24 && (mn >= 225 || mx <= 45); }
    function isDark(c) { if (!c || c.a === 0) return false; return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) < 128; }
    var T = { accent: o.accent || v('--accent') || v('--primary') || v('--primary-color') || null, fg: null, dark: false, cardRadius: '10px', font: null };
    if (!T.accent) {
      var cands = document.querySelectorAll('button,.btn,[role="button"],input[type="submit"],a[class*="btn"]');
      for (var i = 0; i < cands.length; i++) {
        var bg = null;
        try { bg = rgb(getComputedStyle(cands[i]).backgroundColor); } catch (e) {}
        if (bg && !neutral(bg)) { try { T.accent = getComputedStyle(cands[i]).backgroundColor; } catch (e) {} break; }
      }
    }
    var bodyColor = null, bodyBg = null;
    try { bodyColor = getComputedStyle(document.body).color; bodyBg = getComputedStyle(document.body).backgroundColor; } catch (e) {}
    var bgc = rgb(o.bg || v('--bg') || v('--background') || bodyBg);
    T.dark = o.dark === true || isDark(bgc);
    T.fg = o.text || v('--text') || v('--foreground') || bodyColor || (T.dark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.72)');
    try {
      var b0 = document.querySelector('button,.btn,[role="button"]');
      if (b0) { var r = getComputedStyle(b0).borderRadius; if (r && r !== '0px') T.cardRadius = parseFloat(r) >= 14 ? '12px' : r; }
      T.font = getComputedStyle(document.body).fontFamily;
    } catch (e) {}
    T.bg = T.dark ? 'rgba(30,30,34,.92)' : 'rgba(255,255,255,.92)';
    T.border = T.dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.08)';
    if (!T.accent) T.accent = T.dark ? '#4f8cff' : '#07c160';
    return T;
  }

  function applyVars(el, T) {
    el.style.setProperty('--sig-accent', T.accent);
    el.style.setProperty('--sig-bg', T.bg);
    el.style.setProperty('--sig-border', T.border);
    el.style.setProperty('--sig-fg', T.fg);
    el.style.setProperty('--sig-card-radius', T.cardRadius);
    if (T.font) el.style.setProperty('--sig-font', T.font);
  }

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done();
    } catch (e) { /* 复制失败静默 */ }
  }
})();
`;
}

/* ── 注入 ── */
function injectProject(dir, cfg) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error(`❌ 目标目录不存在：${dir}`); process.exit(2); }
  const report = { dir, readme: 'skipped', html: [], staticFiles: {} };

  /* 1. README */
  const readmePath = path.join(dir, 'README.md');
  if (fs.existsSync(readmePath)) {
    const t = fs.readFileSync(readmePath, 'utf8');
    if (!t.includes(README_MARKER)) { fs.writeFileSync(readmePath, t.replace(/\s*$/, '') + '\n\n' + readmeBlock(cfg) + '\n'); report.readme = 'appended'; }
  } else {
    fs.writeFileSync(readmePath, `# ${path.basename(dir)}\n\n` + readmeBlock(cfg) + '\n');
    report.readme = 'created';
  }

  /* 2. static/signature.js|css */
  const staticDir = path.join(dir, 'static');
  fs.mkdirSync(staticDir, { recursive: true });
  for (const [name, content] of [['signature.js', signatureJs(cfg)], ['signature.css', signatureCss()]]) {
    const p = path.join(staticDir, name);
    const existed = fs.existsSync(p);
    if (existed && fs.readFileSync(p, 'utf8') === content) { report.staticFiles[name] = 'unchanged'; continue; }
    fs.writeFileSync(p, content);
    report.staticFiles[name] = existed ? 'updated' : 'created';
  }

  /* 3. HTML 注入（相对路径引用 static/，子目录页面自动回退 ../static） */
  const htmls = [];
  (function rec(d) {
    for (const name of fs.readdirSync(d).sort()) {
      if (SKIP_DIRS.has(name) || name === 'static') continue;
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) rec(full);
      else if (/\.(html?|vue)$/i.test(name)) htmls.push(full);
    }
  })(dir);
  for (const f of htmls) {
    const rel = path.relative(dir, f).split(path.sep).join('/');
    let t = fs.readFileSync(f, 'utf8');
    if (t.includes(SIG_MARKER) || /["'(]signature\.(js|css)/.test(t)) { report.html.push({ file: rel, status: 'skipped' }); continue; }
    const relStatic = path.relative(path.dirname(f), staticDir).split(path.sep).join('/');
    const base = relStatic || 'static';
    const tag = `<!-- ${SIG_MARKER}（add-signature 注入，勿手改） -->\n<link rel="stylesheet" href="${base}/signature.css">\n<script src="${base}/signature.js"></script>`;
    t = /<\/body>/i.test(t) ? t.replace(/<\/body>/i, tag + '\n</body>') : t + '\n' + tag + '\n';
    fs.writeFileSync(f, t);
    report.html.push({ file: rel, status: 'injected' });
  }
  return report;
}

const printReport = (r) => {
  console.log(`README: ${r.readme}`);
  for (const h of r.html) console.log(`HTML ${h.status}: ${h.file}`);
  for (const [k, v] of Object.entries(r.staticFiles)) console.log(`static/${k}: ${v}`);
};

/* ── selftest：对演练靶场副本注入两遍，断言幂等与注入点 ── */
function selftest(cfg) {
  const workspace = fs.existsSync(target) && fs.statSync(target).isDirectory() ? target : path.join(SKILL, 'tests', 'validate-output');
  const work = path.join(workspace, 'signature-selftest');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  fs.cpSync(path.join(SKILL, 'tests', 'fixture-site'), work, { recursive: true });
  const checks = [];
  const ok = (name, cond, detail = '') => { checks.push({ name, ok: !!cond }); console.error(`[${cond ? 'PASS' : 'FAIL'}] selftest/${name} ${detail}`); };

  const r1 = injectProject(work, cfg);
  ok('HTML 注入（2 页）', r1.html.length === 2 && r1.html.every((h) => h.status === 'injected'), JSON.stringify(r1.html));
  ok('static 组件生成', fs.existsSync(path.join(work, 'static', 'signature.js')) && fs.existsSync(path.join(work, 'static', 'signature.css')));
  ok('README 署名段', r1.readme === 'created' && fs.readFileSync(path.join(work, 'README.md'), 'utf8').includes('关于作者'));
  ok('注入点标记在位（login/dashboard）', ['login.html', 'dashboard.html'].every((f) => fs.readFileSync(path.join(work, f), 'utf8').includes(SIG_MARKER)));

  const snapshot = {};
  const walk = (d) => { for (const n of fs.readdirSync(d)) { if (SKIP_DIRS.has(n)) continue; const f = path.join(d, n); fs.statSync(f).isDirectory() ? walk(f) : (snapshot[f] = fs.readFileSync(f, 'utf8')); } };
  walk(work);

  const r2 = injectProject(work, cfg);
  ok('二次注入全部跳过（幂等）', r2.html.length === 2 && r2.html.every((h) => h.status === 'skipped') && Object.values(r2.staticFiles).every((s) => s === 'unchanged') && r2.readme === 'skipped', JSON.stringify(r2));

  let unchanged = true;
  for (const [f, c] of Object.entries(snapshot)) if (fs.readFileSync(f, 'utf8') !== c) { unchanged = false; console.error(`  变动了：${f}`); }
  ok('二次注入后文件内容零变化', unchanged);

  fs.rmSync(work, { recursive: true, force: true });
  const pass = checks.every((c) => c.ok);
  console.error(`\n＝＝＝ add-signature --selftest ${pass ? '✅ 全部通过' : '❌ 存在失败'}：${checks.filter((c) => c.ok).length}/${checks.length}`);
  process.exit(pass ? 0 : 1);
}

/* ── 入口 ── */
const cfg = loadConfig();
if (SELFTEST) { selftest(cfg); } else { printReport(injectProject(target, cfg)); }
