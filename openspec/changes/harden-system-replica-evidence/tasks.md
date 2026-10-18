# 任务清单 · harden-system-replica-evidence

> 按依赖顺序执行；每个任务完成后打勾并写一行证据（命令+结果摘要）。

## T1 · capture-page.mjs 加固（P1+P2+P3）
- [x] T1.1 脱敏函数 `redact(text)`：模式表驱动（access_token/api[_-]?key/secret/password/Authorization/Bearer/手机号/邮箱 → ***REDACTED***），应用于 requestBody/responseBody/URL 查询串/错误信息，写盘前统一调用
  - 证据：字段级+序列化后双道脱敏；实测 requestBody `{"user":"demo","pass":"***REDACTED***"}`、Set-Token 头与响应体 token 打码、URL 查询串邮箱/手机号打码；产物 JSON 全部可解析；5 项明文残留扫描全 0
- [x] T1.2 独立快照：默认输出 `<目录名>-<YYYYMMDD-HHmmss>`；--out 显式指定但非空目录拒绝（exit 2，提示 --force）
  - 证据：实测默认快照 `collect-20261018-*` 独立成目录；`--out` 已存在非空目录 → exit 2 + 提示换目录或 --force
- [x] T1.3 异步等待：networkidle 超时后继续等待 in-flight XHR 至完成或上限；full.png/dom.html 写盘时点记录 lastResponseAt
  - 证据：in-flight Set 跟踪 + 15s 上限循环；notes.md 与 capture-status.json 均记录 lastResponseAt（实测有值）
- [x] T1.4 完成度状态机：capture-status.json（status: complete|skeleton|partial|failed + 依据）；state 占位/notes TODO→至多 skeleton；exit code 0=complete 3=skeleton/partial 1=failed
  - 证据：登录页采集 status=skeleton exit 3；broken.html(404) status=partial exit 3；不可达 URL status=failed exit 1；消费方对损坏/缺失 status 文件保守降级 skeleton（validate 断言过）
- [x] T1.5 reference/02 §一 与 05 模板 B 更新用法（含状态机语义）
  - 证据：02 §一「落地工具」重写（独立快照/自动脱敏/异步等待/四态语义/退出码）；05 模板 B 工具段同步

## T2 · similarity.mjs 加固（P4）
- [x] T2.1 零配对判定：matched=0 且双方行数>0 → 该对 FAIL（zero-pair），计入 compliant
  - 证据：完全无关文件对 → `[ZERO-PAIR]` exit 1（词面亲和度 0.0785<0.30）；目录模式零对进入比对 → FAIL exit 1；保守护栏：亲和度≥0.30 的零行重合对只警告待人工（实测 CLONE_CSS 0% 达标对不误报）
- [x] T2.2 coverage 指标：配对原型行数 / 原型总行数，随报告输出
  - 证据：报告 `summary.coveragePct` + `coverage{pairedPrototypeLines,totalPrototypeLines,pct}`；实测 --map 时 100%、无 map 断裂时 0%
- [x] T2.3 --map <mapping.json>（复刻路径→原型路径）改名映射支持
  - 证据：`node similarity.mjs /tmp/sim-test/replica /tmp/sim-test/proto --map mapping.json` → x.js↔a.js、c.css↔b.css 正确配对（mapped=true）exit 0
- [x] T2.4 头部能力边界声明：文本相似度无法检测逻辑等价重写，须配合行为断言（reference/04）
  - 证据：脚本头注 + 控制台输出 + JSON 报告 `capabilityBoundary` 字段三处声明；reference/03 §二 同步
- [x] T2.5 reference/03 相似度节引用更新
  - 证据：03 §二新增「零配对护栏与覆盖率」「能力边界」两条口径

## T3 · fixture-site 扩展（P5 前置）
- [x] T3.1 POST /api/login.json 端点（校验+响应头 Set-Token: demo-token-xxx）
  - 证据：server.mjs 实测 200+`set-token: demo-token-*`+body{ok,user,token}；缺凭据 400 missing credentials
- [x] T3.2 /api/stats.json 支持 ?v=2 变体（接口变化场景）
  - 证据：curl 基线 `{"visitors":128,...}` vs `?v=2` `{"visitors":999,...,"version":2}`；app.js 登录后按入口 `?api=v2` 透传请求变体
- [x] T3.3 missing.css（恒 404，失败路径）
  - 证据：broken.html 引用 missing.css；伺服器实测 404；capture-page 采集该页 status=partial

## T4 · validate.mjs 升级（P5）
- [x] T4.1 阶段 A 改为 spawn capture-page.mjs 采集 fixture（登录场景；产物落 tests/validate-output/collect/）
  - 证据：`runCapture()` 异步 spawn（spawnSync 曾冻结事件循环致子进程全部 goto 超时，已修复留痕 UPGRADE-v1.2 §五）；主采集 --out 落 collect/
- [x] T4.2 断言：登录 POST 被捕获；捕获文件中 Token 值已脱敏；Set-Token 响应头捕获
  - 证据：三条断言 PASS（登录 POST 捕获 status=200 / requestBody pass=***REDACTED*** 无明文 / set-token 头=***REDACTED*** / 响应体 token=***REDACTED*** 无 demo-token 明文）
- [x] T4.3 断言：接口变化场景（?v=2 前后 api 差异可检出）
  - 证据：两条断言 PASS（捕获 `…/api/stats.json?v=2`；变体 visitors=999 vs 基线 128）
- [x] T4.4 断言：404 失败路径 → capture-status=partial（非 complete）
  - 证据：断言 PASS（collect-broken status=partial，理由含 `GET /missing.css → 404`，exit 3）
- [x] T4.5 断言：弹窗开+关双向
  - 证据：新增断言「弹窗关闭（开+关双向闭环）」PASS（closeModal 后 hidden=true，存 collect-modal-closed.png）
- [x] T4.6 断言：重复采集幂等（二次采集进独立快照、首次证据逐字节不变）
  - 证据：两条断言 PASS（7 个文件 sha256 前后一致；二次采集落独立目录 collect-<ts>）
- [x] T4.7 既有 20 断言零回归
  - 证据：validate 34/34 全绿 exit 0（既有 20 条断言名与语义全部保留：采集 4+建造 5+审查 7+署名 2+网络 2）

## T5 · 口径与文档（P6+P7）
- [x] T5.1 reference/02 §〇：证据来源枚举扩充（+模拟实现/演示数据）
  - 证据：五值枚举表（动态实测/静态推断/双轨互证/模拟实现/演示数据）+「模拟实现与演示数据不得冒充实测」约束；04 §二接口契约行同步引用
- [x] T5.2 reference/04：邻近证据规则 + 验证状态枚举
  - 证据：新增 §八「证据引用与验证状态口径」：邻近元素证据不能替代本元素实测（引用漂移判例+三要素引用+≥90% 抽查）；五状态枚举（实测通过/骨架待补/部分失败/失败/豁免登记）
- [x] T5.3 SKILL.md：两条发布口径
  - 证据：新增「发布与验证状态口径」节：同机克隆试装 ≠ 跨平台验证；SkillHub 提交 ≠ 上架（审核中为独立状态）

## T6 · 收尾
- [x] T6.1 五个改动文件 .bak 快照（回滚点）
  - 证据：`openspec/changes/harden-system-replica-evidence/backup/` 9 个 .bak + fixture-site 快照（capture-page/similarity/validate/SKILL/reference 02·03·04·05/stats.json），实施前完成并记录 sha256
- [x] T6.2 全量验证：preflight + validate（30+ 断言）+ similarity 自测三件 + capture-page 对演练靶场实测
  - 证据：preflight exit 0；validate 34/34 exit 0；similarity 自测 6 件（零配对 FAIL/--map/coverage/零对 FAIL/CSS·JS 达标对回归/用法错）；capture-page 演练靶场 4 路径实测（skeleton/partial/failed/--out 拒绝）并查看 capture-status.json
- [x] T6.3 脱敏复扫 0 命中
  - 证据：对 tests/validate-output 全树 + 演练靶场采集快照扫描（password/token/secret/api key/authorization 值形 ≥8 位且非 REDACTED）0 命中
- [x] T6.4 rsync + sync-check 双副本一致
  - 证据：rsync（排除 tools/、tests/validate-output/、preflight-report.json）后 `node scripts/sync-check.mjs` 全部源文件 sha256 一致 exit 0
- [x] T6.5 SKILL.md 版本 1.2.0 + UPGRADE-v1.2.md 记录
  - 证据：SKILL.md 头部「版本 1.2.0」+ v1.2 变更行；UPGRADE-v1.2.md（含更名记录、交付时分报告：静态检查/本地测试/平台实测[macOS 注明]/跨系统未做列明/未验证项、实施问题留痕 6 条）

## T7 · 独立审查修复 + 用户细化验收（v1.2.1，本工单）
- [x] T7-F1 dom.html 脱敏缺口（审查 FAIL，必修）
  - 证据：redactHtml()（内联 script 块+文本节点过 redact，标签/属性保留）；敏感页实测 6 项泄漏（api_key/Bearer JWT/URL token/手机号/邮箱/username）全 0 命中、结构保留、JSON 可解析；首版实测暴露 JS 裸键（无引号键）漏网→补 1b 模式（保留引号风格）；notes.md 改逐产物口径（已脱敏：api/*.json、dom.html、notes、status ｜ 原文保真：full.png 人工复核）
- [x] T7-1 validate 假阳性消除 + 弹窗双向
  - 证据：建造阶段 [data-stat] 清回占位符（断言「采集时点动态值已清空」）、复刻接口 +1 偏移 128→129（断言「接口值与采集时点区分」）；审查断言改「渲染值==129≠采集值128」；新增「弹窗开+关双向（复刻页行为实测）」；破坏①注入假值999→该断言 FAIL(visitors=999 vs 129) 复原 sha256 一致；破坏②移除弹窗绑定→FAIL(open→visible=false) 复原一致（首跑暴露 closeModal 超时中断→改崩溃安全断言，留痕 UPGRADE §七）
- [x] T7-2 similarity 语义区分（无配对 vs 零相同行）+ 报告三件事
  - 证据：unpairedReplica>0 → unpairedBlocked=true compliant=false exit 1；--map 补齐 → exit 0；--allow-unpaired → unpairedAcknowledged=true 解除阻断（清单仍列示）；零相同行无关对 → zeroPair FAIL exit 1（affinity 0.0969）；正确重写件（配对成立/0%高亲和）→ 不误判 exit 0；报告新增 pairing 配对映射清单（replica→prototype+viaMap），与 coverage、unpaired 并列三件事
- [x] T7-3 capture-page 事件完备 + 保存收口
  - 证据：requestfailed 落 api/（`{"status":null,"failure":"net::ERR_CONNECTION_REFUSED"}`）；capture-status failedRequests=1、status=partial、理由含失败清单；notes 接口清单 `→ 失败(...)`；收口=在途清空且 pendingSaves（含异步读体）全结束后才写 status（首版 `r.request()` TypeError 被本项实测抓出修正，留痕）
- [x] T7-4 普通表单凭据脱敏验证
  - 证据：虚构凭据 CAPTURE_USER=demo-user / CAPTURE_PASS=Demo-Pass-123 登录采集 → 全产物（api/dom/notes/status）+ stdout/stderr/伺服器日志 grep：明文密码=0、明文账号=0（requestBody `{"user":"***REDACTED***","pass":"***REDACTED***"}`）
- [x] T7-5 演示开关绝对表述修正
  - 证据：reference/02 §〇 演示数据行、reference/03 §五 改逐态标注（默认态=原站抓包证据引采集文件；解锁态=推断依据引登记项+模拟验证结果引自测套件）；SKILL.md 新增「演示开关口径（逐态标注）」表；「两态均为采集实证」全库 0 残留
- [x] T7-6 收尾（.bak sha256 登记 / 版本 / 同步）
  - 证据：backup/bak-files.sha256（13 行，审查观察 O1）；SKILL.md 1.2.0→1.2.1（断言数 34→37 同步）；UPGRADE-v1.2.md §七 增补；validate 37/37 exit 0；脱敏复扫 0 命中；rsync+sync-check 双副本一致

- [x] T7-F2 复合标识符裸键漏网（定向复验 FAIL，一行模式修复）
  - 证据：裸键模式 1b 改分词判定（整标识符按驼峰/下划线/连字符/数字切段，任一段精确命中敏感词表才打码，保留引号风格）；回归实测：复合 4 变体（secretToken/secretKey/authTokenValue/mySecret）+ 精确 4 键（api_key/apiKey/token/access_token）泄漏 8/8 全 0；防误伤探针（tokenize the string / monkey 与 keyboard / safeWord）原文全保留，REDACTED 总数恰=8；结构保留；validate 37/37 重放 exit 0；sync-check 双副本一致；版本 1.2.1→1.2.2（UPGRADE-v1.2 §八）

## 验收门禁
T4.7 与 T6.2 任一 FAIL → 不通过；capture-status 误标 complete → 不通过；脱敏破坏 JSON 可解析性 → 不通过。
（门禁核验：T4.7 PASS、T6.2 全过；占位产物 status=skeleton 未误标；脱敏产物 JSON 全部可解析——三门禁均过）
（v1.2.1 复验门禁：T7 全部六项 PASS；F1 泄漏 6/6 归零；细化④ 明文=0；破坏性验证 4 件按预期 FAIL 且复原 sha256 一致——审查方定向复验范围已全部备证）
（v1.2.2 F2 门禁：复合 4 变体+精确 4 键泄漏 8/8 归零；防误伤探针原文保留；validate 37/37 重放；sync-check 一致——F2 定向复验备证完毕，随归档）
