#!/usr/bin/env node
/* sync-check.mjs — 母本 ↔ 发现副本 源文件一致性校验（sha256 清单比对）
 * 用法：node sync-check.mjs [副本路径]
 *   带副本路径：直接比对；不带：自动探测（cwd 及其各级父目录的 .agents/skills/reverse-system-replica-engineer，或 ~/.agents/skills/...）。
 * 比对范围：全部源文件；排除运行产物 tools/、tests/validate-output/、preflight-report.json、.git、node_modules、.DS_Store。
 * 输出：一致 / 差异清单（副本缺失、副本多出、内容不一致逐条列出）；exit 0=一致 1=有差异 2=找不到副本。
 * 口径提醒：母本是唯一编辑点——副本侧「多出」的文件多半是未誊回母本的新教训或陈旧残留，先合并回母本再同步。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDE_DIRS = new Set(['tools', 'node_modules', '.git']);
const EXCLUDE_FILES = new Set(['.DS_Store', 'preflight-report.json']);
const EXCLUDE_SUBSTR = ['tests/validate-output/', 'tests\\validate-output\\'];

function isExcluded(rel) { return EXCLUDE_FILES.has(path.basename(rel)) || EXCLUDE_SUBSTR.some((s) => rel.split(path.sep).join('/').includes(s)); }

function manifest(root) {
  const out = new Map();
  (function rec(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      const rel = path.relative(root, full);
      if (isExcluded(rel)) continue;
      const st = fs.statSync(full);
      if (st.isDirectory()) rec(full);
      else if (st.isFile()) out.set(rel.split(path.sep).join('/'), crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  })(root);
  return out;
}

function findCopy() {
  const arg = process.argv[2];
  if (arg) { const p = path.resolve(arg); return fs.existsSync(p) ? p : null; }
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, '.agents', 'skills', 'reverse-system-replica-engineer');
    if (fs.existsSync(cand) && path.resolve(cand) !== SKILL) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const home = path.join(process.env.HOME || '', '.agents', 'skills', 'reverse-system-replica-engineer');
  if (fs.existsSync(home) && path.resolve(home) !== SKILL) return home;
  return null;
}

const copyPath = findCopy();
if (!copyPath) { console.error('❌ 未找到发现副本：传入路径参数，或先按 SKILL.md「安装与同步」创建 .agents/skills/ 下的副本'); process.exit(2); }
if (path.resolve(copyPath) === SKILL) { console.error('❌ 副本路径与母本相同'); process.exit(2); }

const A = manifest(SKILL);
const B = manifest(copyPath);
const missingInCopy = [];
const extraInCopy = [];
const changed = [];
let same = 0;
for (const [rel, hash] of A) {
  const h2 = B.get(rel);
  if (h2 === undefined) missingInCopy.push(rel);
  else if (h2 !== hash) changed.push(rel);
  else same++;
}
for (const rel of B.keys()) if (!A.has(rel)) extraInCopy.push(rel);

const ok = missingInCopy.length === 0 && extraInCopy.length === 0 && changed.length === 0;
console.error(`＝＝＝ sync-check：母本 ${A.size} 个源文件 ↔ 副本 ${B.size} 个源文件`);
console.error(`副本：${copyPath}`);
if (ok) { console.error(`✅ 一致：${same} 个文件 sha256 全部相同（运行产物 tools/、tests/validate-output/、preflight-report.json 不在比对范围）`); process.exit(0); }
for (const rel of missingInCopy) console.error(`[副本缺失] ${rel}`);
for (const rel of changed) console.error(`[内容不一致] ${rel}`);
for (const rel of extraInCopy) console.error(`[副本多出] ${rel}（未誊回母本的新条目？先合并回母本再同步——母本是唯一编辑点）`);
console.error(`❌ 不一致：相同 ${same} ｜ 缺失 ${missingInCopy.length} ｜ 不一致 ${changed.length} ｜ 多出 ${extraInCopy.length} —— 修好后重跑同步命令`);
process.exit(1);
