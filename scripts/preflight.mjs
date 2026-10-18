#!/usr/bin/env node
/* preflight.mjs — 环境自检 + 依赖自动安装（幂等，可重复跑）
 * 用法：node preflight.mjs [--json] [--install-optional]
 * 分层策略：核心层缺→自动装；按需层缺→提示（--install-optional 时自动装）；深度层缺→仅检测报告，绝不自动装。
 * 口径对齐 deps-manifest.txt：核心层仅 Node/playwright/浏览器内核可判 fail（git 等 core 项 warn 不阻塞）。
 * 产出：preflight-report.json + 控制台摘要；exit 0=就绪 1=核心层未就绪。
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(SKILL, 'tools');
const JSON_OUT = process.argv.includes('--json');
const INSTALL_OPTIONAL = process.argv.includes('--install-optional');
const PW_VERSION = '1.49.1';
const items = [];
const run = (cmd, o = {}) => { try { return { ok: true, out: execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, ...o }).trim() }; } catch (e) { return { ok: false, out: String(e.stdout || '').trim(), err: String(e.stderr || e.message || '').trim() }; } };
const add = (name, level, status, detail, fix = '') => { items.push({ name, level, status, detail: String(detail).slice(0, 400), fix }); console.error(`[${status.toUpperCase().padEnd(7)}] ${level.padEnd(8)} ${name} — ${String(detail).slice(0, 160)}${fix ? ' ｜ ' + fix : ''}`); };

/* 1. Node */
const nodeMajor = Number(process.versions.node.split('.')[0]);
add('Node.js', 'core', nodeMajor >= 20 ? 'ok' : 'fail', `v${process.versions.node}` + (nodeMajor < 24 ? '（<24：node:sqlite 不可用，复刻后端建议升 24+）' : ''));

/* 2. git（core 层 ok/warn 均不计 fail——仅版本对照用，见 deps-manifest 注记） */
const git = run('git --version');
add('git', 'core', git.ok ? 'ok' : 'warn', git.ok ? git.out.split('\n')[0] : '未安装（仅影响版本对照，不阻塞采集；core 层 warn 不判失败）', git.ok ? '' : 'brew install git / apt install git / 官网安装器');

/* 3. tools 目录 + playwright 库 */
fs.mkdirSync(TOOLS, { recursive: true });
const requireTools = createRequire(path.join(TOOLS, 'package.json')); // 进程内解析 tools/node_modules（跨平台安全，不经 shell 拼路径）
const pwPkg = path.join(TOOLS, 'node_modules', 'playwright', 'package.json');
let pwOk = fs.existsSync(pwPkg);
if (!pwOk) {
  const reg = run('npm config get registry').out;
  console.error(`[INSTALL] playwright@${PW_VERSION} （registry=${reg}，首次约 1-2 分钟）…`);
  const r = run(`npm i --prefix "${TOOLS}" playwright@${PW_VERSION}`, { cwd: TOOLS });
  pwOk = r.ok && fs.existsSync(pwPkg);
  add('playwright（库）', 'core', pwOk ? 'ok' : 'fail', pwOk ? `v${PW_VERSION} 安装成功` : `安装失败：${r.err.slice(0, 200)}`, pwOk ? '' : '检查网络/镜像：npm config set registry https://registry.npmmirror.com 后重跑');
} else {
  add('playwright（库）', 'core', 'ok', `已存在（${PW_VERSION}）`);
}

/* 4. 浏览器内核：系统 Chrome → Edge → playwright chromium 下载 */
let browser = null;
const chromeCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
for (const c of chromeCandidates) { if (fs.existsSync(c)) { browser = { kind: 'system', executablePath: c }; break; } }
if (browser) { fs.writeFileSync(path.join(TOOLS, 'browser.json'), JSON.stringify(browser, null, 2)); add('浏览器内核', 'core', 'ok', `系统浏览器：${browser.executablePath}（已写 tools/browser.json）`); }
if (!browser && pwOk) {
  console.error('[INSTALL] 未找到系统 Chrome，下载 playwright chromium（约 150MB，一次性）…');
  const cli = path.join(TOOLS, 'node_modules', 'playwright', 'cli.js');
  const r = run(`node "${cli}" install chromium`);
  let chromiumPath = null;
  try { chromiumPath = requireTools('playwright').chromium.executablePath(); } catch { /* 库损坏时保持 null */ }
  if (r.ok && chromiumPath && fs.existsSync(chromiumPath)) { browser = { kind: 'playwright-chromium', executablePath: chromiumPath }; fs.writeFileSync(path.join(TOOLS, 'browser.json'), JSON.stringify(browser, null, 2)); add('浏览器内核', 'core', 'ok', 'playwright chromium 已下载（已写 tools/browser.json）'); }
  else add('浏览器内核', 'core', 'fail', '系统无 Chrome 且 chromium 下载失败', '安装 Chrome，或检查网络后重跑 preflight');
}

/* 5. 按需层（缺失提示；--install-optional 时自动装） */
const rea = run('rea-agents --version');
if (rea.ok) add('rea-agents CLI', 'optional', 'ok', rea.out.split('\n')[0]);
else if (INSTALL_OPTIONAL) { const r = run('npm i -g rea-agents'); const v = run('rea-agents --version'); add('rea-agents CLI', 'optional', v.ok ? 'ok' : 'warn', v.ok ? v.out.split('\n')[0] : `自动安装失败：${r.err.slice(0, 160)}`, v.ok ? '' : 'npm i -g rea-agents（需权限时用 npx rea-agents 免安装运行），或重跑加 --install-optional'); }
else add('rea-agents CLI', 'optional', 'missing', '未安装（JS 静态分析将回落 grep 正则交叉）', 'npm i -g rea-agents，或 npx 免安装运行，或重跑加 --install-optional');

/* 6. 深度/按需工具层：仅检测报告，绝不自动装（对齐 deps-manifest.txt） */
const probes = [
  ['tshark', 'optional', '抓包文件深度分析（pcap/HAR 之外场景）', 'tshark -v', 'brew install --cask wireshark | apt install tshark | 官网安装器'],
  ['mitmdump', 'optional', 'mitmproxy 抓包文件解析', 'mitmdump --version', 'brew install mitmproxy | apt install mitmproxy | 官网安装器'],
  ['apktool', 'deep', 'Android 解包（动静两轨共用，需 JDK）', 'apktool --version', 'brew install apktool openjdk@17 | apt install apktool default-jdk | 官网'],
  ['java', 'deep', 'JDK（apktool 依赖）', 'java --version', 'brew install openjdk@17 | apt install default-jdk | 官网'],
  ['frida', 'deep', '运行时插桩（深度逆向目标）', 'frida --version', 'pip install frida-tools'],
  ['gdb', 'deep', '调试器（断点观测函数调用）', 'gdb --version', 'brew install gdb | apt install gdb | 官网'],
  ['rizin', 'deep', '调试器/逆向框架', 'rizin -v', 'brew install rizin | apt install rizin | 官网'],
  ['lldb', 'deep', 'macOS 原生函数观测（REA observe_native_calls）', 'lldb --version', '随 Xcode | apt install lldb | 官网'],
  ['binwalk', 'deep', '固件签名识别', 'binwalk --help', 'brew install binwalk | apt install binwalk | WSL'],
  ['unblob', 'deep', '固件解包', 'unblob --help', 'pip install unblob'],
];
for (const [cmd, level, use, check, installCmd] of probes) {
  const r = run(check);
  add(cmd, level, r.ok ? 'ok' : 'missing', r.ok ? r.out.split('\n')[0].slice(0, 120) : `未装（用途：${use}；仅对应目标类型需要）`, r.ok ? '' : installCmd);
}

/* 汇总：pass 仅取决于 core 层有无 fail（warn/missing 均不阻塞——见 deps-manifest 口径注记） */
const core = items.filter(i => i.level === 'core');
const coreFail = core.some(i => i.status === 'fail');
const summary = { checkedAt: new Date().toISOString(), pass: !coreFail, coreOk: core.filter(i => i.status === 'ok' || i.status === 'warn').length, coreTotal: core.length };
fs.writeFileSync(path.join(SKILL, 'preflight-report.json'), JSON.stringify({ pass: summary.pass, checkedAt: summary.checkedAt, items }, null, 2));
if (JSON_OUT) console.log(JSON.stringify({ pass: summary.pass, items }, null, 2));
else console.error(`\n＝＝＝ preflight ${summary.pass ? '✅ 就绪' : '❌ 核心层未就绪'}：核心 ${summary.coreOk}/${summary.coreTotal}（ok+warn）；详见 ${path.join(SKILL, 'preflight-report.json')}`);
process.exit(summary.pass ? 0 : 1);
