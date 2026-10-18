#!/usr/bin/env node
/* similarity.mjs — 重写合规自证脚本（建造方/审查方同一口径）
 * 用法：node similarity.mjs <复刻文件或目录> <原型文件或目录> [--json]
 *
 * 算法（与 skill 红线一致）：
 *   1. 按扩展名剥注释（保守规则：.js 去 // 与 [star]slash 块注释，.css 去块注释，.html 去 <!-- -->，其余不剥）；
 *   2. 去空行、逐行 trim；
 *   3. difflib 等价算法（最长匹配块递归 = SequenceMatcher 同族 LCS）；
 *   4. 重合率 = 重合行数 / 原型行数（原型行数为分母）；
 *   5. 列出全部 ≥7 行的成段重合块（红线：相似度 <40% 且无 ≥7 行成段重合；
 *      ≥7 行块若属契约面——CSS 值/文案/接口路径串/DOM 模板——需人工逐块定性登记后豁免，
 *      脚本按原始指标保守判违规，豁免结论写在审查报告里）。
 *
 * 退出码：0=达标（<40% 且无 ≥7 行块）；1=超线（需返工或逐块豁免登记）；2=用法/输入错误。
 * 目录对目录时按相对路径配对；单文件直接成对。未配对文件会列出（不参与计算）。
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , replicaArg, protoArg] = process.argv;
const JSON_MODE = process.argv.includes('--json');
const THRESHOLD_PCT = 40;
const BLOCK_MIN = 7;
const MAX_LINES = 20000; // 单文件行数上限（超出则跳过该对并登记，防止 O(n·m) 爆内存）

if (!replicaArg || !protoArg) {
  console.error('用法：node similarity.mjs <复刻文件或目录> <原型文件或目录> [--json]');
  process.exit(2);
}

/* ── 剥注释（保守规则：字符串感知的轻量扫描，不做正则字面量特判） ── */
function stripComments(text, ext) {
  if (ext === '.css' || ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.jsx' || ext === '.ts') {
    // .css：块注释；.js 族：行注释+块注释（逐字符状态机，跳过字符串/模板串内部）
    let out = '';
    let i = 0;
    const isJs = ext !== '.css';
    while (i < text.length) {
      const c = text[i], n = text[i + 1];
      if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); i = e === -1 ? text.length : e + 2; out += ' '; continue; }
      if (isJs && c === '/' && n === '/') { const e = text.indexOf('\n', i); i = e === -1 ? text.length : e; continue; }
      if (isJs && (c === '"' || c === "'" || c === '`')) {
        const quote = c; out += c; i++;
        while (i < text.length) {
          if (text[i] === '\\') { out += text[i] + (text[i + 1] || ''); i += 2; continue; }
          out += text[i];
          if (text[i] === quote) { i++; break; }
          i++;
        }
        continue;
      }
      out += c; i++;
    }
    return out;
  }
  if (ext === '.html' || ext === '.htm' || ext === '.vue') {
    let out = text.replace(/<!--[\s\S]*?-->/g, ' ');
    return out;
  }
  return text; // 其余扩展名不剥（登记为口径边界）
}

function codeLines(file) {
  const ext = path.extname(file).toLowerCase();
  const raw = fs.readFileSync(file, 'utf8');
  return stripComments(raw, ext)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/* ── difflib 等价：最长匹配块递归（SequenceMatcher 同族，junk 关闭） ── */
function matchBlocks(A, B) {
  const b2j = new Map();
  B.forEach((line, j) => {
    let arr = b2j.get(line);
    if (!arr) { arr = []; b2j.set(line, arr); }
    arr.push(j);
  });
  const blocks = [];
  function findLongest(alo, ahi, blo, bhi) {
    let besti = alo, bestj = blo, bestsize = 0;
    const j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      const idxs = b2j.get(A[i]);
      if (idxs) {
        for (const j of idxs) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
      }
      j2len.clear();
      for (const [kk, vv] of newj2len) j2len.set(kk, vv);
    }
    return [besti, bestj, bestsize];
  }
  function recurse(alo, ahi, blo, bhi) {
    const [i, j, k] = findLongest(alo, ahi, blo, bhi);
    if (k) {
      if (alo < i && blo < j) recurse(alo, i, blo, j);
      blocks.push([i, j, k]);
      if (i + k < ahi && j + k < bhi) recurse(i + k, ahi, j + k, bhi);
    }
  }
  recurse(0, A.length, 0, B.length);
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const merged = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && last[0] + last[2] === b[0] && last[1] + last[2] === b[1]) last[2] += b[2];
    else merged.push([...b]);
  }
  return merged;
}

/* ── 文件配对 ── */
function walkFiles(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p]; // 单文件
  const out = [];
  (function rec(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === 'node_modules' || name === '.git' || name === 'tools' || name === '.DS_Store') continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) rec(full);
      else out.push(full);
    }
  })(p);
  return out;
}
const isDirA = fs.statSync(replicaArg).isDirectory();
const isDirB = fs.statSync(protoArg).isDirectory();
const pairs = [];
const unpairedReplica = [];
const unpairedProto = [];
if (isDirA && isDirB) {
  const keyOf = (root, f) => path.relative(root, f).split(path.sep).join('/');
  const mapB = new Map(walkFiles(protoArg).map((f) => [keyOf(protoArg, f), f]));
  for (const f of walkFiles(replicaArg)) {
    const k = keyOf(replicaArg, f);
    const b = mapB.get(k);
    if (b) pairs.push({ replica: f, prototype: b, key: k });
    else unpairedReplica.push(k);
  }
  for (const k of mapB.keys()) if (!pairs.some((p) => p.key === k)) unpairedProto.push(k);
} else if (!isDirA && !isDirB) {
  pairs.push({ replica: replicaArg, prototype: protoArg, key: path.basename(replicaArg) });
} else {
  console.error('输入错误：两个参数必须同为文件或同为目录');
  process.exit(2);
}

/* ── 逐对计算 ── */
const pairResults = [];
let skipped = 0;
for (const { replica, prototype, key } of pairs) {
  let A, B;
  try { A = codeLines(replica); B = codeLines(prototype); } catch (e) { skipped++; pairResults.push({ key, error: String(e.message || e) }); continue; }
  if (A.length > MAX_LINES || B.length > MAX_LINES) {
    skipped++;
    pairResults.push({ key, error: `文件过大（replica=${A.length} 行 / prototype=${B.length} 行 > ${MAX_LINES}），建议分块后比较`, replicaLines: A.length, prototypeLines: B.length });
    continue;
  }
  const blocks = matchBlocks(A, B);
  const matched = blocks.reduce((s, b) => s + b[2], 0);
  const pct = B.length ? +(matched / B.length * 100).toFixed(1) : (A.length ? 100 : 0);
  const difflibRatio = +(2 * matched / (A.length + B.length || 1)).toFixed(4);
  const blocksOver = blocks.filter((b) => b[2] >= BLOCK_MIN).map(([ai, bi, k]) => ({
    lines: k,
    prototypeLines: `${bi + 1}-${bi + k}`,
    replicaLines: `${ai + 1}-${ai + k}`,
    preview: B.slice(bi, bi + Math.min(3, k)),
  }));
  pairResults.push({
    key,
    replica: path.resolve(replica),
    prototype: path.resolve(prototype),
    replicaLines: A.length,
    prototypeLines: B.length,
    matchedLines: matched,
    similarityPct: pct,
    difflibRatio,
    blocksTotal: blocks.length,
    blocksOver,
  });
}

const ok = pairResults.filter((p) => p.similarityPct !== undefined);
const totalMatched = ok.reduce((s, p) => s + p.matchedLines, 0);
const totalProto = ok.reduce((s, p) => s + p.prototypeLines, 0);
const totalReplica = ok.reduce((s, p) => s + p.replicaLines, 0);
const overallPct = totalProto ? +(totalMatched / totalProto * 100).toFixed(1) : 0;
const bigBlockCount = ok.reduce((s, p) => s + p.blocksOver.length, 0);
const compliant = overallPct < THRESHOLD_PCT && bigBlockCount === 0 && skipped === 0;

const report = {
  metric: '重合率 = 重合行数 / 原型行数（剥注释、去空行、difflib 等价最长匹配块）',
  threshold: { maxSimilarityPct: THRESHOLD_PCT, blockMinLines: BLOCK_MIN },
  compliant,
  summary: { overallPct, totalMatched, totalPrototypeLines: totalProto, totalReplicaLines: totalReplica, bigBlocks: bigBlockCount, pairs: pairResults.length, skipped },
  pairs: pairResults,
  unpaired: { replicaOnly: unpairedReplica, prototypeOnly: unpairedProto },
};

if (JSON_MODE) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.error(`＝＝＝ 相似度自证（口径：<${THRESHOLD_PCT}% 且无 ≥${BLOCK_MIN} 行成段重合）＝＝＝`);
  for (const p of pairResults) {
    if (p.error) { console.error(`[SKIP] ${p.key} — ${p.error}`); continue; }
    console.error(`[${p.similarityPct < THRESHOLD_PCT && p.blocksOver.length === 0 ? 'PASS' : 'OVER'}] ${p.key}：${p.similarityPct}%（重合 ${p.matchedLines}/${p.prototypeLines} 行，difflib 比率 ${p.difflibRatio}，≥${BLOCK_MIN} 行块 ${p.blocksOver.length} 个）`);
    for (const b of p.blocksOver) console.error(`    · 重合块 ${b.lines} 行（原型 ${b.prototypeLines} ↔ 复刻 ${b.replicaLines}）：${b.preview.join(' ⏎ ').slice(0, 160)}`);
  }
  console.error(`汇总：整体 ${overallPct}% ｜ ${compliant ? '✅ 达标' : '❌ 超线（结构性重排后复测，或对 ≥7 行块逐块定性豁免并登记）'}`);
  if (unpairedReplica.length || unpairedProto.length) console.error(`未配对：复刻侧 ${unpairedReplica.length} 个 / 原型侧 ${unpairedProto.length} 个（不参与计算，请核对范围）`);
}
process.exit(compliant ? 0 : 1);
