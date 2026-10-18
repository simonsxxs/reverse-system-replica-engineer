#!/usr/bin/env node
/* similarity.mjs — 重写合规自证脚本（建造方/审查方同一口径）
 * 用法：node similarity.mjs <复刻文件或目录> <原型文件或目录> [--json] [--map <mapping.json>] [--allow-unpaired]
 *
 * ⚠ 能力边界（先读这个）：本脚本度量的是**文本相似度**（剥注释后逐行重合），
 *   它**无法检测逻辑等价重写**（换语言重写、算法替换、逐语句语义等价但表达不同）——
 *   相似度达标 ≠ 行为一致。文本指标必须与**行为断言**（逐功能实测、接口契约逐字段比对、
 *   0 pageerror、非豁免 4xx=0，见 reference/04）配合使用，两者都过才算重写合规。
 *
 * 两类"零"的语义区分（v1.2.1，勿混）：
 *   ① 无配对文件（unpaired）：复刻侧文件没配到任何原型（改名未映射/目录错位）——**无法验收**，
 *      不参与相似度计算，但**阻断 overall 达标**，直至 --map 补齐映射或加 --allow-unpaired 人工确认范围；
 *   ② 零相同行（zero line overlap）：配对成立但 0 行重合——按词面亲和度分诊：
 *      亲和度 < 0.30 → 判 FAIL（zero-pair，疑似拿错原型/配对断裂）；
 *      亲和度 ≥ 0.30 → 不判 FAIL，输出警告待人工复核逻辑等价并配合行为断言。
 *      阈值标定（v1.2 实测）：同源重写对 J≥0.48，同域无关对 J≤0.24。已知边界：同域不同项目的
 *      CSS 对词面底噪可达 ~0.5，此时护栏不判 FAIL 只给警告——宁可漏报交人工，不可误杀真达标。
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
 * 退出码：0=达标（<40% 且无 ≥7 行块且无 zero-pair 且无阻断性未配对）；1=超线（需返工或逐块豁免登记或补配对）；2=用法/输入错误。
 * 报告必含三件事：①配对映射清单（report.pairing：复刻路径→原型路径，含 --map 来源标记）；
 * ②覆盖范围（report.coverage/summary.coveragePct）；③未覆盖项清单（report.unpaired：复刻侧/原型侧/映射未命中）。
 * 目录对目录时按相对路径配对（--map 可提供改名映射）；单文件直接成对。
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , replicaArg, protoArg] = process.argv;
const JSON_MODE = process.argv.includes('--json');
const ALLOW_UNPAIRED = process.argv.includes('--allow-unpaired');
const mapFlagIndex = process.argv.indexOf('--map');
const MAP_PATH = mapFlagIndex > -1 ? process.argv[mapFlagIndex + 1] : null;
const THRESHOLD_PCT = 40;
const BLOCK_MIN = 7;
const MAX_LINES = 20000; // 单文件行数上限（超出则跳过该对并登记，防止 O(n·m) 爆内存）
const ZERO_PAIR_MIN_AFFINITY = 0.3; // 零相同行护栏阈值（标定见头部注）

if (!replicaArg || !protoArg || (mapFlagIndex > -1 && !MAP_PATH)) {
  console.error('用法：node similarity.mjs <复刻文件或目录> <原型文件或目录> [--json] [--map <mapping.json>] [--allow-unpaired]\n  mapping.json 格式：{ "复刻相对路径": "原型相对路径", ... }（目录模式改名映射）\n  --allow-unpaired：人工确认未配对范围（解除无配对阻断，报告中显式登记 unpairedAcknowledged）');
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

/* ── 字符 bigram 词面亲和度（零配对护栏用；Jaccard，剥注释后小写、空白折叠） ── */
function bigramJaccard(fileA, fileB) {
  const setOf = (file) => {
    const ext = path.extname(file).toLowerCase();
    const t = stripComments(fs.readFileSync(file, 'utf8'), ext).toLowerCase().replace(/\s+/g, ' ');
    const s = new Set();
    for (let i = 0; i < t.length - 1; i++) s.add(t.slice(i, i + 2));
    return s;
  };
  try {
    const a = setOf(fileA), b = setOf(fileB);
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
  } catch { return 0; }
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

/* 改名映射：JSON 对象 { 复刻相对路径: 原型相对路径 } */
let renameMap = null;
let mapError = null;
if (MAP_PATH) {
  try {
    renameMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
    if (typeof renameMap !== 'object' || renameMap === null || Array.isArray(renameMap)) mapError = '映射文件顶层必须是对象 { "复刻相对路径": "原型相对路径" }';
  } catch (e) { mapError = '映射文件读取/解析失败：' + String(e.message || e); }
  if (mapError) { console.error('❌ ' + mapError); process.exit(2); }
}

const isDirA = fs.statSync(replicaArg).isDirectory();
const isDirB = fs.statSync(protoArg).isDirectory();
const pairs = [];
const unpairedReplica = [];
const unpairedProto = [];
const mapMisses = [];
if (isDirA && isDirB) {
  const keyOf = (root, f) => path.relative(root, f).split(path.sep).join('/');
  const mapB = new Map(walkFiles(protoArg).map((f) => [keyOf(protoArg, f), f]));
  const usedProto = new Set();
  for (const f of walkFiles(replicaArg)) {
    const k = keyOf(replicaArg, f);
    let b = null, mappedTo = null;
    if (renameMap && Object.prototype.hasOwnProperty.call(renameMap, k)) {
      mappedTo = renameMap[k];
      const cand = path.join(protoArg, mappedTo);
      if (mapB.has(mappedTo) && !usedProto.has(mappedTo)) { b = mapB.get(mappedTo); usedProto.add(mappedTo); }
      else mapMisses.push({ replica: k, mappedTo, reason: mapB.has(mappedTo) ? '原型目标已被其他映射占用' : '映射目标在原型侧不存在' });
    }
    if (!b && !usedProto.has(k)) { b = mapB.get(k); if (b) usedProto.add(k); }
    if (b) pairs.push({ replica: f, prototype: b, key: k, mapped: Boolean(mappedTo) });
    else unpairedReplica.push(k);
  }
  for (const k of mapB.keys()) if (!usedProto.has(k)) unpairedProto.push(k);
} else if (!isDirA && !isDirB) {
  if (MAP_PATH) console.error('[WARN] 单文件模式忽略 --map（改名映射仅目录模式生效）');
  pairs.push({ replica: replicaArg, prototype: protoArg, key: path.basename(replicaArg), mapped: false });
} else {
  console.error('输入错误：两个参数必须同为文件或同为目录');
  process.exit(2);
}

/* ── 逐对计算 ── */
const pairResults = [];
let skipped = 0;
for (const { replica, prototype, key, mapped } of pairs) {
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
  /* 零配对护栏（v1.2）：零行重合 + 双方非空 → 按词面亲和度保守分诊 */
  let zeroPair = false, zeroLineOverlap = false, affinity = null;
  if (matched === 0 && A.length > 0 && B.length > 0) {
    affinity = +bigramJaccard(replica, prototype).toFixed(4);
    if (affinity < ZERO_PAIR_MIN_AFFINITY) zeroPair = true;
    else zeroLineOverlap = true;
  }
  pairResults.push({
    key,
    mapped: Boolean(mapped),
    replica: path.resolve(replica),
    prototype: path.resolve(prototype),
    replicaLines: A.length,
    prototypeLines: B.length,
    matchedLines: matched,
    similarityPct: pct,
    difflibRatio,
    blocksTotal: blocks.length,
    blocksOver,
    zeroPair,
    zeroLineOverlap,
    affinity,
  });
}

const ok = pairResults.filter((p) => p.similarityPct !== undefined);
const totalMatched = ok.reduce((s, p) => s + p.matchedLines, 0);
const totalProto = ok.reduce((s, p) => s + p.prototypeLines, 0);
const totalReplica = ok.reduce((s, p) => s + p.replicaLines, 0);
const overallPct = totalProto ? +(totalMatched / totalProto * 100).toFixed(1) : 0;
const bigBlockCount = ok.reduce((s, p) => s + p.blocksOver.length, 0);
const zeroPairCount = ok.filter((p) => p.zeroPair).length;
const zeroLineOverlapCount = ok.filter((p) => p.zeroLineOverlap).length;
/* 覆盖率（v1.2）：已配对原型行数 / 全部原型行数（目录模式才有意义；单文件恒 100%） */
const allProtoLines = (isDirB ? walkFiles(protoArg) : [protoArg]).reduce((s, f) => { try { return s + codeLines(f).length; } catch { return s; } }, 0);
const coveragePct = allProtoLines ? +(Math.min(totalProto, allProtoLines) / allProtoLines * 100).toFixed(1) : 0;
/* 目录模式下没有任何文件进入比对 = 配对整体断裂（拿错目录/全改名），与单对 zero-pair 同源假达标，一并判不达标 */
const zeroPairsAll = isDirA && isDirB && pairs.length === 0;
/* 无配对文件（复刻侧未配到原型）= 无法验收：不参与计算但阻断 overall 达标，直至 --map 补齐或 --allow-unpaired 人工确认 */
const unpairedBlocked = isDirA && isDirB && unpairedReplica.length > 0 && !ALLOW_UNPAIRED;
const compliant = overallPct < THRESHOLD_PCT && bigBlockCount === 0 && skipped === 0 && zeroPairCount === 0 && !zeroPairsAll && !unpairedBlocked;

const report = {
  metric: '重合率 = 重合行数 / 原型行数（剥注释、去空行、difflib 等价最长匹配块）',
  capabilityBoundary: '文本相似度无法检测逻辑等价重写（换语言/算法替换/语义等价表达不同）；须配合行为断言（reference/04）才算重写合规',
  threshold: { maxSimilarityPct: THRESHOLD_PCT, blockMinLines: BLOCK_MIN, zeroPairMinAffinity: ZERO_PAIR_MIN_AFFINITY },
  compliant,
  summary: { overallPct, totalMatched, totalPrototypeLines: totalProto, totalReplicaLines: totalReplica, bigBlocks: bigBlockCount, pairs: pairResults.length, skipped, zeroPairs: zeroPairCount, zeroLineOverlaps: zeroLineOverlapCount, zeroPairsAll, unpairedReplica: unpairedReplica.length, unpairedBlocked, unpairedAcknowledged: ALLOW_UNPAIRED && unpairedReplica.length > 0, coveragePct, totalPrototypeLinesAll: allProtoLines },
  coverage: { pairedPrototypeLines: totalProto, totalPrototypeLines: allProtoLines, pct: coveragePct, note: 'coverage <100% 表示原型侧有内容未进入比对（改名未映射/目录错位）——不得只看整体重合率' },
  pairing: pairResults.map((p) => ({ replica: p.key, prototype: isDirB ? path.relative(protoArg, p.prototype).split(path.sep).join('/') : p.prototype, viaMap: Boolean(p.mapped), similarityPct: p.similarityPct })),
  pairs: pairResults,
  unpaired: { replicaOnly: unpairedReplica, prototypeOnly: unpairedProto, mapMisses },
};

if (JSON_MODE) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.error(`＝＝＝ 相似度自证（口径：<${THRESHOLD_PCT}% 且无 ≥${BLOCK_MIN} 行成段重合且无 zero-pair；coverage ${coveragePct}%）＝＝＝`);
  console.error(`⚠ 能力边界：文本相似度无法检测逻辑等价重写——须配合行为断言（reference/04）`);
  for (const p of pairResults) {
    if (p.error) { console.error(`[SKIP] ${p.key} — ${p.error}`); continue; }
    const verdict = p.zeroPair ? 'ZERO-PAIR' : (p.similarityPct < THRESHOLD_PCT && p.blocksOver.length === 0 ? 'PASS' : 'OVER');
    console.error(`[${verdict}] ${p.key}${p.mapped ? '（--map 映射）' : ''}：${p.similarityPct}%（重合 ${p.matchedLines}/${p.prototypeLines} 行，difflib 比率 ${p.difflibRatio}，≥${BLOCK_MIN} 行块 ${p.blocksOver.length} 个${p.affinity !== null ? `，词面亲和度 ${p.affinity}` : ''}）`);
    if (p.zeroPair) console.error(`    · zero-pair：零行重合且词面亲和度 < ${ZERO_PAIR_MIN_AFFINITY}——疑似拿错原型/配对断裂，请核对文件对应关系（可用 --map 提供改名映射）`);
    if (p.zeroLineOverlap) console.error(`    · 零行重合但词面亲和度 ${p.affinity} ≥ ${ZERO_PAIR_MIN_AFFINITY}：完全重写或形态差异——不判 FAIL，须人工复核逻辑等价并配合行为断言`);
    for (const b of p.blocksOver) console.error(`    · 重合块 ${b.lines} 行（原型 ${b.prototypeLines} ↔ 复刻 ${b.replicaLines}）：${b.preview.join(' ⏎ ').slice(0, 160)}`);
  }
  console.error(`汇总：整体 ${overallPct}% ｜ coverage ${coveragePct}% ｜ ${compliant ? '✅ 达标' : '❌ 超线（结构性重排后复测，或对 ≥7 行块逐块定性豁免并登记；zero-pair 先核对配对关系）'}`);
  if (zeroPairsAll) console.error(`❌ 零配对：目录模式下没有任何文件进入比对——疑似拿错目录/文件全部改名，请核对两侧路径（改名用 --map 提供映射）`);
  if (unpairedReplica.length && !ALLOW_UNPAIRED) console.error(`❌ 无配对文件 ${unpairedReplica.length} 个（复刻侧未配到原型，无法验收）——用 --map 补齐映射，或加 --allow-unpaired 人工确认范围`);
  if (unpairedReplica.length && ALLOW_UNPAIRED) console.error(`[人工确认] 未配对 ${unpairedReplica.length} 个已由 --allow-unpaired 确认范围（报告 unpairedAcknowledged=true，审查时须附人工确认记录）`);
  if (unpairedProto.length) console.error(`原型侧未覆盖 ${unpairedProto.length} 个（已计入 coverage 分母，核对是否有漏建页面）`);
  if (unpairedReplica.length || unpairedProto.length) console.error(`未配对：复刻侧 ${unpairedReplica.length} 个 / 原型侧 ${unpairedProto.length} 个（不参与计算，请核对范围）`);
  for (const m of mapMisses) console.error(`[映射未命中] ${m.replica} → ${m.mappedTo}（${m.reason}）`);
}
process.exit(compliant ? 0 : 1);
