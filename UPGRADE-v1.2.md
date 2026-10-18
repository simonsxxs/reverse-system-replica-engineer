# UPGRADE v1.2.0 · 升级实现说明

- 日期：2026-10-18
- 变更：`harden-system-replica-evidence`（采集安全与验收可信度加固）+ Skill 显示名更名
- 方案：`openspec/changes/harden-system-replica-evidence/proposal.md`（已批准执行）
- 回滚点：`openspec/changes/harden-system-replica-evidence/backup/`（9 个 .bak + fixture 快照，实施前对全部将改文件快照）
- 验证结论（全部真实执行，本机 = macOS 15 arm64 / Node v24.12.0）：preflight ✅ exit 0；validate ✅ 34/34 断言 exit 0；similarity 自测 6 件全过；capture-page 对演练靶场实测 4 条路径全过；脱敏复扫 0 命中；rsync+sync-check 双副本一致。

## 一、交付时分报告

### 1. 静态检查

| 项 | 结果 |
| --- | --- |
| `node --check` 三脚本语法 | capture-page.mjs / similarity.mjs / validate.mjs 全部通过（以实际运行代替——三者均在验证中真实执行） |
| fixture 伺服器端点冒烟（curl） | POST /api/login.json 200+Set-Token / 缺凭据 400 / stats 基线与 ?v=2 变体 / missing.css 恒 404 / favicon 204 / 根路径 200 |
| 称谓扫描 | 「系统 1:1 复刻」仅存在于 SKILL.md H1（reference/01-07 标题与正文无旧称谓，更名后全库 0 残留） |

### 2. 本地测试（全部真实执行）

| 项 | 结果 |
| --- | --- |
| preflight | ✅ exit 0（核心层 Node/playwright/浏览器内核全绿） |
| validate | ✅ **34/34 断言** exit 0（既有 20 断言语义零回归 + 新增 14 断言），报告在 tests/validate-output/validate-report.json |
| capture-page 登录采集（演练靶场） | ✅ status=skeleton、exit 3、api×2 落盘、capture-status.json 五件套清单齐 |
| capture-page 失败路径（broken.html→404） | ✅ status=partial（理由含 `GET /missing.css → 404`）、exit 3 |
| capture-page 打不开的 URL | ✅ status=failed、exit 1（失败也落 capture-status.json） |
| capture-page --out 非空目录 | ✅ exit 2 拒绝并提示 --force；用法错误 exit 2 |
| 脱敏实测 | ✅ requestBody `"pass":"***REDACTED***"`；Set-Token 响应头打码；响应体 token 打码；URL 查询串邮箱/手机号打码；全部 api JSON 可解析（脱敏不破坏结构）；明文残留 5 项扫描全 0 |
| similarity 零配对 | ✅ 完全无关文件对 → ZERO-PAIR FAIL exit 1（词面亲和度 0.0785 < 0.30） |
| similarity --map 改名映射 | ✅ 映射对正确配对（mapped=true）、coverage 100%、exit 0 |
| similarity 零对进入比对（目录全断裂） | ✅ FAIL exit 1 + 提示核对目录/映射 |
| similarity 既有达标对回归 | ✅ CLONE_CSS 0% / CLONE_JS 5.5% 均不误报（0% 对输出 zeroLineOverlap 警告待人工，不判 FAIL） |
| rsync + sync-check | ✅ 双副本 sha256 全一致（清单见 §4） |

### 3. 平台实测（本机 = macOS，注明）

- 以上全部测试在 **macOS 15（arm64）+ Node v24.12.0 + 系统 Chrome** 实机执行；对外表述口径：「已在 macOS 验证」（见 SKILL.md「发布与验证状态口径」）。

### 4. 跨系统验证（未做，列明）

- Windows / Linux 实机未验证（无目标机器授权）：capture-page 的路径处理已用 `path` API 规避拼接问题，但浏览器内核探测、spawn 行为、文件锁差异均未经实机确认；
- 发现副本同步在 macOS 本机双目录间完成（`rsync -a` 排除 tools/、tests/validate-output/、preflight-report.json），未验证 Windows robocopy 路径。

### 5. 未验证项

- 脱敏模式表对真实站点复杂形态（GraphQL 变量、二进制 body 内嵌文本、多级嵌套 stringified JSON 之外的新形态）的覆盖率未在真实目标上回归——使用时仍须人工复核（reference/07 §三 的义务不因自动脱敏免除）；
- similarity 零配对亲和度阈值 0.30 基于本仓库 7 组实测标定（同源 ≥0.48 / 同域无关 ≤0.24），未在跨项目样本上复标；
- capture-status「complete」态需人工补齐 state/notes 后核升，本版本只有 skeleton/partial/failed 的机器实测路径。

## 二、变更清单（对照 proposal）

| 文件 | 变更 | 关键点 |
| --- | --- | --- |
| scripts/capture-page.mjs | P1+P2+P3 全量落地 | ①`redact()` 模式表驱动（敏感键值对/Bearer·Basic/手机号/邮箱/URL 查询串敏感参数 + 敏感响应头 set-token/cookie/authorization 整值打码），字段级+序列化后双道脱敏，只替换字符串值内部；②独立快照：默认 `<基名>-<YYYYMMDD-HHmmss>`，`--out` 非空目录 exit 2 拒绝（`--force` 放行）；networkidle 超时后继续等在途 XHR（上限 15s），记录 lastResponseAt；③capture-status.json 四态状态机 + 依据清单，退出码 0/3/1/2 区分 |
| scripts/similarity.mjs | P4 | ①零行重合且词面亲和度 <0.30 → zero-pair FAIL；≥0.30 → 警告待人工（不误杀达标对）；目录模式零对进入比对也 FAIL；②coverage = 已配对原型行数/全部原型行数；③`--map mapping.json`（复刻相对路径→原型相对路径）改名映射；④头部能力边界声明：文本相似度无法检测逻辑等价重写，须配合行为断言 |
| scripts/validate.mjs | P5 | 阶段 A 改为 spawn capture-page.mjs 闭环自检（4 次采集：主采集 --out collect/、幂等二次采集、?api=v2 接口变化、broken.html 404）；断言 20→34 |
| tests/fixture-site/* | T3 | 新增 server.mjs（POST /api/login.json 校验+Set-Token、stats ?v=2 变体、favicon 204、/missing.css 恒 404）；app.js 登录改真实 POST（登录成功过渡态停留 600ms）；新增 broken.html（引用 missing.css 的失败路径页） |
| reference/02 | §〇 五值来源枚举 + §一 工具新用法 | 动态实测/静态推断/双轨互证/模拟实现/演示数据；独立快照/自动脱敏/状态机语义/退出码 |
| reference/03 | §二 相似度口径 | 零配对护栏、coverage、--map、能力边界 |
| reference/04 | §二 口径对齐 + 新增 §八 | 接口契约来源标注改五值枚举；「邻近元素证据不能替代本元素实测」引用漂移规则；验证状态五枚举（实测通过/骨架待补/部分失败/失败/豁免登记） |
| reference/05 | 模板 B | 采集任务书对齐新工具行为与完成度口径 |
| SKILL.md | 更名 + 发布口径 + 1.2.0 | H1「逆向系统复刻工程师 · 通用方法论与工具链」；description 补人设定位句；「发布与验证状态口径」两条；版本 1.2.0 |
| tests/fixture-site/server.mjs | 新增 | 演练靶场伺服器（可独立运行供 capture-page 实测，也被 validate 复用） |

## 三、更名记录（追加任务）

- Skill 显示名：「系统 1:1 复刻」→「**逆向系统复刻工程师**」；
- SKILL.md：H1 改「逆向系统复刻工程师 · 通用方法论与工具链」；frontmatter description 开头补人设定位句；正文无其他旧称谓（全库扫描确认）；
- reference/01-07：标题与正文核查无旧称谓，无需改动；
- **保持不变**（外链稳定）：目录名 `system-1to1-replica`、GitHub/Gitee 仓库名、发现副本路径、deps-manifest 与脚本内路径常量、frontmatter `name` 字段。

## 四、母本→发现副本同步

- 命令：`rsync -a --exclude tools --exclude tests/validate-output --exclude preflight-report.json <母本>/ <发现路径>/`
- 校验：`node scripts/sync-check.mjs` → 全部源文件 sha256 一致（结果见当次执行记录）。

## 五、实施中发现并修复的问题（留痕）

1. **spawnSync 冻结伺服器**（validate 侧）：capture-page 首版用 spawnSync 调用，而 fixture 伺服器跑在 validate 进程内——spawnSync 阻塞事件循环导致子进程采集器全部 goto 超时。改异步 `spawn` + Promise 后恢复。教训：同进程伺服器 + 子进程自测必须走异步 spawn。
2. **嵌套 stringified JSON 脱敏漏网**：requestBody 是 JSON-in-JSON，序列化后引号转义导致「敏感键值对」模式失配。改为字段级脱敏（原始未转义文本先过 redact 再入 rec）+ 序列化后双保险。
3. **fixture 密码字段名 `pass` 不在敏感键表**：表内原只有 password/passwd/pwd，补 `pass(?:word|wd)?`。
4. **登录响应体被 Chromium 回收**：登录 POST 后页面立即跳转，`Network.getResponseBody` 报 No resource。fixture 登录成功改为过渡态停留 600ms（真实登录流常见形态），采集器可完整读体。
5. **零对进入比对的假达标**：目录模式下全部改名断裂时 pairs=[] 仍判达标（正是问题 #4 的极端形态），补 zeroPairsAll FAIL。
6. **affinity 不能做单一全局阈值**：实测同域无关 CSS 对词面底噪高达 0.51（signature.css 判例），故设计为「低亲和（<0.30）判 FAIL + 高亲和零行重合只警告待人工」的保守分层，宁漏报交人工、不误杀达标对（误报即算法回归）。

## 六、断言清单（validate 37 条，v1.2.1 更新）

采集 18：捆绑采集器闭环自检 / capture-status=骨架 / api 全可解析 / 登录 POST 捕获 / 凭据脱敏 / Set-Token 头捕获且脱敏 / 响应体假 token 脱敏 / 接口响应捕获 / capture-status 损坏缺失保守降级 / 重复采集幂等（首次快照逐字节不变）/ 独立快照目录 / 接口变化 ?api=v2 端点捕获 / 变体响应可区分 / 404→partial / 登录页 DOM 存档 / 登录流跳转工作台 / 弹窗状态采集 / 弹窗关闭双向；
建造 7：复刻页生成（白标）/ 接口产物落位 / 采集时点动态值已清空 / 接口值与采集时点区分（+1 偏移）/ 样式脚本落位 / 重写合规·脚本 / 重写合规·样式；
审查 10：白标标题 / 复刻标记 / 接口数据真实渲染（==新接口值≠采集值）/ 可点元素在位 / 弹窗开+关双向（复刻页行为实测）/ 视觉冒烟 / tab 切换 / tab 激活态 / 非豁免 4xx=0 / 0 pageerror；
署名 2：胶囊注入 / 风格自适应。

## 七、v1.2.1 · 独立审查修复与用户细化验收（2026-10-18）

依据：`openspec/changes/harden-system-replica-evidence/review.md`（有条件通过，33 PASS / 1 FAIL）+ 用户追加 5 条细化验收项。tasks.md T7 段逐项留痕。

### F1 · dom.html 脱敏缺口（审查 FAIL，已修复）

- capture-page.mjs 新增 `redactHtml()`：**HTML 感知脱敏**——内联 `<script>` 块内容整体过 redact，标签之间文本节点过 redact，标签与属性原样保留（结构与标签不改动，替换值为纯文本不引入引号/尖括号）；
- 实测新增脱敏模式「JS 裸键赋值」（无引号键 `{ api_key: "..." }` / `token = '...'`，保留原引号风格）——首版实测裸键泄漏被破坏性测试抓出后补上；
- 敏感页实测（api_key/Bearer JWT/URL token/手机号/邮箱/username 六项）：dom.html 泄漏扫描 **6/6 全 0 命中**，标签结构保留，api JSON 全部可解析；
- notes.md 脱敏声明改为**逐产物口径**：已脱敏（api/*.json、dom.html[文本节点+内联脚本]、notes、capture-status）/ 原文保真（full.png 截图，人工复核）——不再一揽子宣称；
- 敏感键表扩充：`user(?:name)?|account|mobile|phone`（普通表单凭据覆盖，保守过量脱敏可接受）。

### 用户细化 5 条（全部落地）

| # | 项 | 落地 | 硬证明 |
| --- | --- | --- | --- |
| 1 | validate 假阳性消除 | 建造阶段把渲染 DOM 的 `[data-stat]` 清回占位符 `…`；复刻接口产物 +1 偏移（visitors 128→129）；断言改「渲染值==新接口值≠采集时点值」；新增复刻页弹窗开+关双向断言 | 破坏①：fetch 回调注入假值 999 → 「接口数据真实渲染」**FAIL**（visitors=999 vs 129）→ 复原 sha256 一致；破坏②：移除弹窗绑定 → 「弹窗开+关双向」**FAIL**（open→visible=false）→ 复原一致 |
| 2 | similarity 语义区分 | 「无配对文件」（复刻侧未配到原型）=无法验收，不参与计算但**阻断 overall 达标**（`--map` 补齐或 `--allow-unpaired` 人工确认解除，报告记 unpairedAcknowledged）；「零相同行」（配对成立 0 重合）维持亲和度分诊；报告新增 `pairing` 配对映射清单（复刻路径→原型路径+viaMap），与 coverage、unpaired 清单并列为报告三件事 | 未映射 zzz.js → unpairedBlocked=true compliant=false exit 1；--allow-unpaired → unpairedAcknowledged=true exit 0（清单仍列示）；全映射 → coverage 100% 语义成立；零相同行无关对 → zeroPair FAIL exit 1；正确重写件（配对成立/0% 高亲和）→ 不误判 exit 0 |
| 3 | capture-page 事件完备 | 注册 `requestfailed`（URL+failure 文本落 api/、notes 接口清单状态列 `失败(...)`）；收口条件=在途请求清空 **且** 全部响应保存任务（pendingSaves，含异步读体）结束后才生成 capture-status | 连接失败页实测：api/001 含 `{"status":null,"failure":"net::ERR_CONNECTION_REFUSED"}`；capture-status `failedRequests=1`、status=partial、理由含失败清单；notes 接口清单行 `→ 失败(net::ERR_CONNECTION_REFUSED)`。ERR_ABORTED（导航取消噪声）仍落盘留证但不计入失败信号（代码注释注明） |
| 4 | 表单凭据脱敏验证 | 敏感键表扩充后，虚构凭据 CAPTURE_USER=demo-user / CAPTURE_PASS=Demo-Pass-123 走登录采集 | 全产物（api/*.json、dom.html、notes.md、capture-status）+ stdout/stderr/伺服器日志 grep：明文密码=0、明文账号=0（requestBody 双双 `***REDACTED***`） |
| 5 | 演示开关绝对表述修正 | reference/02 §〇 演示数据行、reference/03 §五 改逐态标注；SKILL.md 新增「演示开关口径（逐态标注）」表：默认态=原站抓包证据（引采集文件）、解锁态=推断依据（引登记项）+模拟验证结果（引自测套件） | 「两态均为采集实证」全库 0 残留（grep 核对） |

### 实施留痕（v1.2.1）

1. **requestfailed 回调参数是 Request 对象**（非 Response）——首版按 `r.request().method()` 取值直接 TypeError，破坏性运行抓出后改为 `r.method()/r.resourceType()`；
2. **裸键脱敏缺口**：JSON 引号模式只命中 `"key":"value"`，JS `{ api_key: "value" }` 裸键漏网——补 1b 模式（保留引号风格）；
3. **弹窗断言崩溃安全**：绑定缺失时 `click('#closeModal')`（隐藏弹窗内按钮）30s 超时抛异常中断整轮——破坏② 首跑暴露；改短超时+catch 降级读态，让断言干净 FAIL 而非中断（这正是破坏性验证的价值）；
4. validate 断言 34→37（+清空动态值、+接口值区分、+复刻页弹窗双向）；SKILL.md 版本 1.2.0→1.2.1；
5. .bak sha256 补登记（审查观察 O1）：`backup/bak-files.sha256`（9 个 .bak + fixture 快照共 13 行）。

### v1.2.1 验证结论（全部真实执行，本机 macOS）

validate **37/37 exit 0**；F1 敏感页泄漏扫描 6/6 全 0；虚构凭据全产物+日志 grep=0；requestfailed 落盘三处可查（api/capture-status/notes）；破坏性验证 4 件全部按预期 FAIL 并复原（sha256 一致）；脱敏复扫 0 命中；sync-check 双副本一致。

## 八、v1.2.2 · 定向复验 F2 修复（2026-10-18）

依据：定向复验结论「有条件收官——F2 一行正则修复后即可归档」。

**F2 · 复合标识符裸键漏网**：裸键脱敏模式原用 `\b(SENSITIVE_KEY)\b` 词边界锚点，对复合命名失配（`secretToken` 中 `token` 前有词字符，`\b` 不成立），4 变体（secretToken/secretKey/authTokenValue/mySecret）值原文落盘。

**修法（一行模式重写）**：裸键模式 1b 从「词表 `\b` 锚点」改为**整标识符分词判定**——正则捕获完整标识符 `([A-Za-z_$][\w$]*)` + 赋值符 + 引号值，替换函数 `isSensitiveIdentifier(key)` 将标识符按驼峰/下划线/连字符/数字边界切段，任一段精确命中敏感词表（password/passwd/pwd/pass/apikey/key/token/secret/authorization/credential/session/sessionid/auth/user/username/account/mobile/phone）才打码，保留原引号风格。分词判定同时满足两个方向：复合标识符（secretToken→[secret,Token]）命中；普通整段词（tokenize/monkey/keyboard）不误伤——比子串匹配 `\w*token\w*` 更精确（后者会把 tokenize 也打掉）。

**回归证据（全部真实执行）**：

| 项 | 结果 |
| --- | --- |
| 复合 4 变体（secretToken/secretKey/authTokenValue/mySecret 值） | dom.html 泄漏 4/4 全 0 |
| 词表精确键名（api_key/apiKey/token/access_token 值） | 泄漏 4/4 全 0 |
| 防误伤探针（"tokenize the string" / "monkey 与 keyboard" / safeWord 赋值） | 原文全部保留；dom.html REDACTED 总数恰=8（仅敏感值被打码） |
| 结构保留 | `<p>`/`</script>`/`<body>` 计数不变 |
| validate 重放 | 37/37 exit 0 |
| sync-check | 双副本 sha256 全一致 |

版本 1.2.1 → **1.2.2**（SemVer patch）。
