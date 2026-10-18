# 独立审查报告 · harden-system-replica-evidence（v1.1.1 → v1.2.0，v1.2.1 定向复验与 v1.2.2 F2 复验见文末）

- 审查日期：2026-10-18 ｜ 审查者：独立审查子智能体（与执行 Agent 分离，宁可误报不可漏报）
- 审查基准：`proposal.md`（验收场景与失败判定）+ `tasks.md`（T1-T6）+ `UPGRADE-v1.2.md`（建造自述，逐条独立复现，不轻信）
- 方法：全部结论来自审查者本机独立复现（/tmp 独立靶场 + skill 演练靶场 + 破坏性抽查），证据存 `review-evidence/`

## 总体结论

**有条件通过。** 15 组检查 33 项 PASS、1 项 FAIL（F1：dom.html 未脱敏的覆盖面缺口）。F1 不触发 proposal 四项失败判定的字面门禁（验收场景 1 明确限定 api/*.json，该范围实测 PASS），但按「宁可误报不可漏报」授权与 P1「写盘前统一脱敏」的宣称意图判为安全缺口，**建议以 v1.2.1 小版本修复（dom.html 写盘前过 redact + 修正 notes.md 声明口径）后收官**；若用户接受「DOM 保真优先」口径，须先修正 notes.md 的过度承诺声明并登记已知边界，再放行 v1.2.0。其余全部达标，放行无保留。

## 逐项结论表

### A. capture-page.mjs 四态与脱敏（对独立 /tmp 靶场 + 演练靶场实测）

| # | 检查项 | 结论 | 独立复现证据 |
| --- | --- | --- | --- |
| A1 | 脱敏生效（api/*.json 真实值=0、REDACTED 在位、JSON 可解析） | **PASS（范围内）／FAIL（范围外缺口 F1）** | 审查者自建 /tmp 敏感页（api_key/手机号/邮箱 + Authorization 头 + URL token 参数）采集：api JSON 内 url 查询串 token、set-token 响应头、api_key、phone、mail 全部 `***REDACTED***`，6 项真实值在 api/*.json 命中 0，JSON 全部可解析（A-capture/A1-api-redacted.json）。**但 dom.html 未脱敏**：内联脚本中的 URL token、Authorization Bearer 值与渲染后的 api_key/phone/mail 原文落盘（A-capture/A1-dom-leak-evidence.txt）→ 见 FAIL 清单 F1 |
| A2 | 独立快照 | PASS | 同参数连续两次采集 → 两个独立时间戳目录；full.png/dom.html/api/*.json/state 占位逐字节 sha256 一致（capture-status.json/notes.md 因内嵌采集时间戳必然不同，属合理）；`--out` 指向非空目录 → exit 2 + 提示 --force，原文件未被触碰（A-capture/A2-run1.sha256、A2-run2.sha256、A2-out-reject.txt） |
| A3 | 状态机四态 + 保守降级 | PASS | 登录流 → status=skeleton、exit 3、依据=state 占位+notes TODO（A3-login-skeleton-status.json）；broken.html（missing.css 404）→ partial、exit 3、理由含 `GET /missing.css → 404`；不可达 URL（ERR_UNSAFE_PORT 与连接拒绝双测）→ failed、exit 1 且状态文件落盘（A3-failed/refused-status.json）；损坏 capture-status.json 与缺失目录 → 消费方按 skeleton 降级（独立复现 readCaptureStatus 逻辑 + validate 断言 9 双证） |
| A4 | 异步等待 lastResponseAt | PASS | lastResponseAt 在 notes.md 与 capture-status.json 双落在位（2026-10-18T09:28:44.385Z = 本地 17:28:44.385）；full.png/dom.html mtime 同秒稍后（响应收齐→500ms→截图），时点关系合理 |

### B. similarity.mjs 零配对与覆盖

| # | 检查项 | 结论 | 独立复现证据 |
| --- | --- | --- | --- |
| B5 | 零配对判定与护栏 | PASS | 无关对（零行重合、词面亲和度 0.1702<0.30）→ `[ZERO-PAIR]` FAIL exit 1（B-similarity/B5a.txt）；同词表压缩单行 vs 展开多行（零行重合、亲和度 0.6852≥0.30）→ 仅警告 exit 0 不 FAIL；目录级全改名断裂 → zeroPairsAll FAIL exit 1（B5c-dir-zero-pair.txt）。首测曾以过短样例触发 1 行语法行重合（`}`）绕过护栏——护栏按 matched=0 判定，符合设计，非缺陷 |
| B6 | coverage + --map | PASS | 手工数行核对：原型 a.js 4 行 + b.css 6 行=10 行；无 map → coverage 0/10=0%、FAIL exit 1；全映射 → x.js↔a.js、c.css↔b.css 均 mapped=true、coverage 10/10=100%、exit 0；部分映射（仅 x→a）→ coverage 40%（4/10）数值精确（B6-map-full.txt） |
| B7 | 既有达标对不误报 | PASS | validate 真实产物重放：app-clone.js vs app.js → 5.5% PASS exit 0；styles.css 0% 对（亲和度 0.7646）→ PASS 不误报、输出 zeroLineOverlap 警告待人工——「CSS 0% 达标对不误报」承诺成立 |

### C. validate.mjs 升级

| # | 检查项 | 结论 | 独立复现证据 |
| --- | --- | --- | --- |
| C8 | 重放 34/34 + 真实 spawn | PASS | 审查者三轮重放（基线/净版复原后）均 34/34 exit 0（validate-report.baseline.json、validate-final.log）；阶段 A 产物 collect/ 含 capture-page 特有结构（capture-status.json status=skeleton、api/001-login/002-stats 命名、state 占位），collect-v2/collect-broken/collect-<ts> 四路采集目录齐备——进程级闭环成立（runCapture 用异步 spawn，spawnSync 教训留痕于代码注释） |
| C9 | 六类新断言在位 + 破坏性抽查 | PASS | 六类（登录 POST 脱敏/Set-Token 头/接口变化 ?api=v2/404→partial/弹窗开关/重复采集幂等）18 条采集断言逐条在位且 PASS（validate-report 断言明细）。破坏性抽查 2 条：①Set-Token 断言期望值改错 → 该条 FAIL（33/34 exit 1）；②404 断言期望改 complete → 该条 FAIL（实际 status=partial 被正确检出）——均为真断言，复原后 sha256 与原版一致（validate-destruct1/2 日志、validate.mjs.orig.sha256） |
| C10 | 既有 20 断言零回归 | PASS | 对照 backup/validate.mjs.bak：旧 21 个断言名（20 条运行时 + 1 条兜底分支）在新版**全部保留、零改名零删除**（old-assertion-names.txt、old-assertion-keep-check.txt）；语义逐条比对一致（网络 2 条并入审查 phase，名称与判据不变） |

### D. 更名与口径

| # | 检查项 | 结论 | 证据 |
| --- | --- | --- | --- |
| D11 | 更名 | PASS | SKILL.md H1=「逆向系统复刻工程师 · 通用方法论与工具链」、description 首句人设定位在位、版本 1.2.0；全库 grep「系统 1:1 复刻」仅命中 UPGRADE-v1.2.md 的更名记录本身（属变更记载，非自称残留）；reference/01-07 无旧称谓；目录名/frontmatter name/外链路径保持不变（与自述一致）；发现副本已同步 |
| D12 | 口径三处 | PASS | reference/02 §〇 五值来源枚举（动态实测/静态推断/双轨互证/模拟实现/演示数据）+「不得冒充实测」约束在位；reference/04 §二 引用五值枚举对齐 + §八「邻近元素证据不能替代本元素实测」（引用漂移判例+三要素+≥90% 抽查）与验证状态五枚举（实测通过/骨架待补/部分失败/失败/豁免登记）完整；SKILL.md 两条发布口径（同机克隆试装 ≠ 跨平台验证、SkillHub 提交 ≠ 上架）逐字在位 |

### E. 收尾与红线

| # | 检查项 | 结论 | 证据 |
| --- | --- | --- | --- |
| E13 | 收尾 | PASS（含 1 观察项 O1） | sync-check 复跑：排除审查期新增文件后 **43/43 sha256 一致** exit 0；脱敏复扫（手机号/邮箱/键值赋值/sk- 型/Bearer 真值/外部 URL 六类，全库+validate-output+审查快照）**全部 0 命中**；9 个 .bak 在位且经核对均为 v1.1.1 真实旧版（validate.bak 无 runCapture、capture-page.bak 无 redact、similarity.bak 无 zeroPair、SKILL.bak H1=旧称谓）；tasks.md 全部打勾且附命令级证据；UPGRADE-v1.2.md 存在且含交付分报告（静态/本地/平台注明 macOS/跨系统未做列明/未验证项/6 条实施留痕） |
| E14 | 红线 | PASS | ①UPGRADE-v1.1.md（14:56）与评审报告（14:56）mtime 均早于变更窗口起点（proposal 16:44），未动；②git log 仍 1 个提交，未提交新变更；③全库采集产物 URL 仅 127.0.0.1（含审查全程），无外部目标站访问；④GEO/01_active 无本变更写入（唯一窗口内文件为 17:33:40 另一并行会话的 GEO 台账更新，内容与本变更零交集，见观察项 O3） |

## FAIL 清单（根因分类）

| # | 项 | 现象 | 根因分类 | 建议修复 |
| --- | --- | --- | --- | --- |
| F1 | A1 脱敏覆盖面 | dom.html 写盘前未过 redact()：页面渲染值与内联脚本中的 token/Bearer/api_key/手机号/邮箱原文落盘（实测 5 项真实值全中）；且 notes.md 声明「本产物已在写盘前自动脱敏」未把 dom.html/full.png 列为例外，构成过度承诺 | 脱敏覆盖面缺口（实现层）+ 声明口径失真（文档层） | capture-page.mjs dom.html 写盘前调用 redact()（工作量一处）；notes.md 脱敏声明改为「api/*.json、notes、capture-status 已自动脱敏；full.png 为图像无法文本脱敏、须人工复核」。建议 v1.2.1 hotfix |

不触发 proposal 失败判定的说明：验收场景 1 字面范围为 api/*.json（实测 PASS）；「JSON 不可解析」「误标 complete」「算法误报」三项门禁均未触发。F1 列为 FAIL 系审查授权「宁可误报不可漏报」下的安全缺口从严定性。

## 观察项

| # | 观察 | 说明 |
| --- | --- | --- |
| O1 | 9 个 .bak 的 sha256「登记在案」未落到仓内文件 | tasks.md T6.1 证据称「实施前完成并记录 sha256」，但变更目录与 backup/ 内无登记文件。审查已代为计算登记（bak-files.sha256）。建议补一份 manifest 入 backup/，或把 tasks.md 措辞改为「快照在位可校验」 |
| O2 | validate.mjs mtime（17:33）晚于执行者收尾（17:19） | 系审查破坏性抽查后从发现副本复原所致；sha256 与审查前记录一致，且复原后净版重放 34/34 exit 0 证明完好。非执行者改动 |
| O3 | `01_active/GEO 系统复刻/说明文档.md` 于 17:33:40 被更新 | 内容为 GEO 项目台账（百应波次推进），与本变更零交集；执行者产物时间线止于 17:19，且该写入发生在审查会话进行中——判定为另一并行会话所为。GEO 红线对本变更成立。另：git status 中 `01_active/GEO/...` 删除项在审查开始前即存在（用户侧目录整理），与本变更无关 |
| O4 | html 相似度对 64.9% OVER 不在合规断言内 | validate 的重写合规断言仅覆盖 JS/CSS；复刻页由采集 DOM 派生，高相似属预期。口径合理，仅登记备忘 |
| O5 | 00_INDEX.md 仍登记 v1.1.0 口径（mtime 16:01 早于窗口） | 项目级索引未随 v1.2.0 更新，非本变更承诺范围，建议后续顺手同步 |
| O6 | capture-status.json/notes.md 跨次采集 sha256 必然不同 | 内嵌采集时间戳所致；幂等断言以「首次快照不被二次采集触碰」为口径，实现正确 |

## 放行意见

**v1.2.0 可收官，建议附带一项 hotfix。** 全部功能承诺、口径承诺、收尾红线经独立复现成立；唯一 FAIL（F1）不属门禁违约而是脱敏覆盖面缺口，修复成本一处代码 + 一句文档。推荐路径：先出 v1.2.1（dom.html 脱敏 + notes.md 声明修正 + .bak sha256 补登记），复跑 validate 34 断言后归档本变更；若用户明确接受「DOM 原文保真、人工复核兜底」口径，也可按现状放行 v1.2.0，但 notes.md 的「本产物已自动脱敏」声明必须先修正——当前措辞会让使用者误信 dom.html 已脱敏。

—— 独立审查子智能体 ｜ 2026-10-18

---

# 定向复验 · v1.2.1（2026-10-18 第二轮）

- 复验范围：F1 修复 + 用户细化 5 条 + 破坏性验证重放（建造方自述逐条独立复现，不轻信）
- 基线：validate **37/37 exit 0**（审查者本机重放两轮：基线 + 复原后净版，validate-report.*.json 存档）

## 定向复验结论表

| 项 | 结论 | 独立复现证据 |
| --- | --- | --- |
| F1 dom.html 脱敏 | **大部分成立，但复验发现 F2 残留缺口** | 自造敏感页 v2（JSON 键值 + **JS 裸键**`api_key:"AKIA..."`与`token='...'` + 复合裸键`secretToken='jwt...'` + Authorization Bearer + URL token + 手机号 + 邮箱 + username + set-token 头）采集实测：9 项敏感值 8 项全产物 0 命中（含裸键 api_key、渲染值、username——v1.2.0 时全部泄漏）；HTML 结构保留（script/div/html 标签在位）、api JSON 全部可解析、notes.md 逐产物口径实文在位（已脱敏：api/dom/notes/status ｜ 原文保真：full.png 人工复核）。**但复合标识符裸键漏网**：`secretToken = 'jwt-...'` 原文落盘 dom.html（v121-F1/leak-scan.txt、bare-key-variants.txt） |
| 细化① +1 偏移假阳性消除 | PASS | 复刻接口产物 visitors=129 vs 采集 128；三条新断言（偏移区分/动态值清空/渲染值==129≠128）全 PASS；复刻页弹窗开+关双向 PASS |
| 细化② unpairedBlocked | PASS | 未配对（无 flag）→ unpairedBlocked=true compliant=false exit 1；混合场景（1 配对+1 未配）`--allow-unpaired` → unpairedAcknowledged=true 解除阻断 exit 0 且 unpaired 清单仍列示；`--map` 补齐 → exit 0 + pairing 清单（viaMap=true）+ coverage 100%；零配对全断裂时 `--allow-unpaired` 仍 FAIL（zeroPairsAll 兜底——无任何比对不得验收，语义合理）；零相同行护栏照常开火（配对成立但无关内容 → zeroPair FAIL） |
| 细化③ requestfailed | PASS | 连接拒绝 fetch 实测：api/001 落 `{"status":null,"failure":"net::ERR_CONNECTION_REFUSED"}`、capture-status failedRequests=1/status=partial/理由含失败清单、notes 接口清单行 `→ 失败(...)` 三处齐（requestfailed-api.json）；ERR_ABORTED 噪声条款与 pendingSaves 收口逻辑代码在位（工程判断注释） |
| 细化④ 虚构凭据 | PASS | `CAPTURE_USER=demo-user / CAPTURE_PASS=Demo-Pass-123` 登录采集：全产物+stdout/伺服器日志 grep 明文=0，requestBody `{"user":"***REDACTED***","pass":"***REDACTED***"}`（credential-grep.txt） |
| 细化⑤ 逐态标注 | PASS | SKILL.md「演示开关口径（逐态标注）」表在位（默认态=原站抓包证据/解锁态=推断依据+模拟验证结果）；reference/02 §〇 演示数据行、reference/03 §五 同步；「两态均为采集实证」在业务代码与 reference 中 0 残留（仅 tasks.md 变更记载引用旧表述，属修复记录非口径残留） |
| 破坏性重放（抽 2 条） | PASS | ①**偏移移除**（复刻接口值改回采集值 128）→ 恰好 2 条断言 FAIL（`接口值与采集时点区分`+`接口数据真实渲染`，35/37 exit 1）——假阳性判据真拦截，复原 sha256 一致（destruct1-offset-removed.log）；②零相同行无关对 FAIL + 正确重写件不误判——已在细化②矩阵中自然复现（首测无关内容触发 zeroPair、重写内容 exit 0） |
| 断言数一致性 | PASS | validate 运行时断言 37（+1 兜底分支=38 处 assert）；报告 37/37；SKILL.md（v1.2.1：37 断言全过）与 UPGRADE §六/§七（34→37）一致 |
| 收尾 | PASS | bak-files.sha256 13 行（O1 关闭）；sync-check 复跑 69/69 一致（缺失项均为审查证据新增，已同步归零）；红线复核：UPGRADE-v1.1（15:41）/评审报告（14:56）未动、git 仍 1 提交、01_active 自 17:40 后零写入、全程未访问外部目标站 |

## FAIL 清单（v1.2.1 增补）

| # | 项 | 现象 | 根因 | 建议 |
| --- | --- | --- | --- | --- |
| F2 | 复合标识符裸键漏网 | 裸键模式 `\b(SENSITIVE_KEY)\b` 的词边界锚点对**复合命名**失配：`secretToken=`/`secretKey=`/`authTokenValue=`/`mySecret=` 四变体全部漏网（词表精确键名 `api_key`/`apiKey`/`token`/`access_token` 均正常拦截）。建造方破坏性测试的 `api_key:` 样本恰好词表精确命中，未覆盖复合命名 | 同 F1 族残留：裸键覆盖不全（实现层一行正则：`\b(...)\b` 放宽为允许前后缀词字符，或 `([\w-]*(?:SENSITIVE_KEY)[\w-]*)` 整体打码） | v1.2.2 一行正则修复 + 用本报告 4 个复合变体做回归；修后即可归档 |

与 F1 的定性区别：F1 是「声明已脱敏 vs 实际未脱敏」的声明失真；v1.2.1 的 notes.md 已改逐产物口径且明确「自动脱敏不免除人工复核义务」——F2 是覆盖面边界且声明带人工兜底，不构成过度承诺，故严重度低于 F1。

## v1.2.1 收官结论

**有条件收官：建议 v1.2.2 一行正则修复 F2 后归档。** T7 六项与破坏性验证全部经独立复现成立（37/37、泄漏 8/9 归零、假阳性判据真拦截、unpairedBlocked/--map/--allow-unpaired 矩阵、requestfailed 三处、虚构凭据 0 命中、逐态标注 0 残留、收尾红线全过）。F2（复合标识符裸键）为新增残留缺口，修复与验证成本极低；若需立即归档 v1.2.1，须由用户确认接受「复合键名靠人工复核兜底」边界并留痕——审查方推荐先修后归（预计十分钟内完成修复+复验）。

—— 独立审查子智能体（第二轮定向复验）｜ 2026-10-18

---

# F2 复验 · v1.2.2（2026-10-18 第三轮，终验）

- 复验范围：F2 修复（裸键分词判定）。建造方自述逐条独立复现，不轻信。
- 方法：单元矩阵（直调 capture-page 实际 redact 实现）+ 实采样页（v2 敏感页扩展复合键/防误伤行）+ 代码审读 + validate 重放。

## F2 复验结论表

| 项 | 结论 | 独立复现证据 |
| --- | --- | --- |
| 代码审读 | PASS | 模式 1b 从「词表 `\b` 锚点」改为「整标识符泛捕获 + `isSensitiveIdentifier` 分词白名单回调」：驼峰/字母数字/下划线连字符切段、全小写精确比对 SENSITIVE_WORDS；**引号键仍走模式 1**（子串匹配，引号定界无歧义）；非敏感标识符原样返回（`rep` 回调返回 `m`），无新引入误伤面；设计取舍（弃 `\w*(...)\w*` 子串防 tokenize 误伤）已在代码注与 UPGRADE §八 双处写明 |
| ①复合变体+精确键名（应拦 8/8） | PASS | 单元矩阵 8/8 CAUGHT（secretToken/secretKey/authTokenValue/mySecret + api_key/apiKey/token/access_token）；实采样页 12 项敏感值（复合 4 + 引号键/裸键 + URL token + Bearer + 渲染值 + 响应头）全产物 **0 命中**（v122-F2/live-leak-scan.txt） |
| ①防误伤（应保留） | PASS | 单元矩阵 7/7 原文保留（tokenize 赋值/tokenizeStr/monkey/keyboard/safeWord/passenger/hotkey）；实采 tokenizer/monkeyBusiness 赋值原文保留各 1 |
| 结构与状态机回归 | PASS | dom.html 标签锚点在位、api JSON 全部可解析、capture-status=skeleton 正常 |
| ③validate 重放 + sync-check | PASS | validate **37/37 exit 0**（本机重放）；sync-check 双副本一致（审查证据同步后 82/82） |
| ④记录核对 | PASS | UPGRADE-v1.2 §八（修法叙述与实际代码一致、含子串方案弃用理由与回归表）；tasks.md T7-F2 打勾附证据；版本 1.2.1→1.2.2（SKILL.md 头部在位） |
| 红线 | PASS | UPGRADE-v1.1（15:41）/评审报告（14:56）未动；git 仍 1 提交；01_active 本窗口零写入；全程未访问外部目标站 |

## 归档结论

**变更 harden-system-replica-evidence（v1.1.1 → v1.2.2）通过，准予归档，放行发布更新序列。**

三轮审查闭环：v1.2.0 提出 F1 → v1.2.1 修复 F1 并落地用户细化 5 条（复验发现 F2）→ v1.2.2 修复 F2（分词判定，拦截/防误伤双向成立）。至此审查提出的全部 FAIL（F1、F2）与观察项（O1 已关、O2/O3 属审查侧说明、O4/O5/O6 备忘）均已处置或定性完毕；proposal 四项失败判定与 v1.2.1/v1.2.2 复验门禁全部 PASS。遗留提示（不阻塞归档）：O5 项目索引 00_INDEX.md 仍为 v1.1.0 口径，建议归档后顺手同步；full.png 图像脱敏属固有限制，依赖 notes.md 逐产物口径下的人工复核义务（已如实声明）。

—— 独立审查子智能体（第三轮 F2 复验/终验）｜ 2026-10-18
