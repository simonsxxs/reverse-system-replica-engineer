# 提案：harden-system-replica-evidence（采集安全与验收可信度加固）

> change-id: harden-system-replica-evidence ｜ 状态：已批准执行（2026-10-17 用户「直接批准执行」）
> 影响：system-1to1-replica skill v1.1.1 → v1.2.0 ｜ 母本：05_skills/system-1to1-replica/

## 为什么做（问题证据，均已对照源码核实）

| # | 问题 | 证据（文件:行） | 后果 |
| --- | --- | --- | --- |
| 1 | capture-page 脱敏只靠人工提醒 | capture-page.mjs:45-51 请求体/响应体/URL/错误信息原文落盘；:103-104 仅 notes 模板「脱敏提醒」 | 采集含真实 key/token 的站点时，敏感值直接进入证据文件 |
| 2 | 采集无独立快照、异步等待 best-effort | capture-page.mjs:33-34（OUT 直写不隔离）、:55-56（api 序号每次从 001 重启，重跑新旧文件混染）、:74（networkidle 超时仅告警继续）、:76-77（截图/DOM 可能早于晚到响应） | 历史证据被覆盖；新旧接口文件混杂；证据集内部时序不一致 |
| 3 | 采集完成度无状态区分 | capture-page.mjs:78（state 占位）、:81-105（notes 骨架 TODO）、:107（仍然 ✅ exit 0） | 占位产物看起来像完整五件套，违反 reference/02「缺一不算完成」 |
| 4 | similarity 零配对可通过 | similarity.mjs:170（matched=0 → pct=0 → <40 判 PASS）、:198（compliant 不检查零配对）；unpaired 仅列出（:149,206） | 拿错原型/文件改名后配对断裂 → 0% 假达标；无覆盖率指标；无改名映射；无文本相似度能力边界声明 |
| 5 | validate 未调用捆绑采集器 + 场景缺口 | validate.mjs:112-135（阶段 A 为内联迷你采集，未调用 capture-page.mjs）；缺失场景：真实登录 POST、响应 Token、接口变化、失败路径(4xx/5xx)、弹窗开+关、重复采集幂等 | 捆绑采集器的缺陷 validate 抓不到；六类常见采集场景无回归覆盖 |
| 6 | 证据来源与验证状态口径分散 | reference/02 §〇 有三态但 04 未对齐；6-1 实证「邻近按钮证据替代本按钮实测」的引用漂移未沉淀为规则 | 引用失真复发；证据可信度口径因人而异 |
| 7 | 支持范围与发布状态口径缺失 | SKILL.md 有范围声明但无「同机克隆试装 ≠ 跨平台验证」「SkillHub 提交 ≠ 上架」两条发布口径 | 发布声明过度承诺（实证：终验放行意见即按此口径措辞） |

## 变更内容（修改文件）

| 文件 | 变更 |
| --- | --- |
| scripts/capture-page.mjs | P1 写盘前统一脱敏（请求体/响应体/URL/错误信息，模式表驱动：key/token/secret/password/手机号/邮箱/Bearer）；P2 独立快照（输出目录自动 `<名称>-<时间戳>` 或 --out 显式指定；已存在非空目录拒绝并提示 --force）+ 异步等待策略（networkidle 超时后仍等待 in-flight XHR 完成；截图/DOM 时点记录最后响应时间戳）；P3 采集完成度状态机（complete / skeleton / partial / failed 四态写入 capture-status.json，state 占位与 notes TODO 不算 complete，exit code 区分） |
| scripts/similarity.mjs | 零配对（matched=0 且双方行数>0）判 FAIL 并输出 zero-pair 警告；新增覆盖率指标（coverage = 配对文件原型行数 / 全部原型行数）；--map 支持改名映射文件（JSON：复刻路径→原型路径）；头部新增能力边界声明（文本相似度无法检测逻辑等价重写/换语言重写，须配合行为断言） |
| scripts/validate.mjs | 阶段 A 改为**真实调用 capture-page.mjs** 采集 fixture（闭环自检）；fixture 新增：登录 POST 端点、带 Token 响应头、可切换的接口变化端点、一个恒 404 路径（失败路径）；断言新增：登录 POST 被捕获且脱敏生效（响应含假 token 但捕获文件中 token 字段被打码）、Token 响应头捕获、接口变化场景（前后两次采集 api 文件差异可检出）、404 失败路径计入采集状态（partial 而非 complete）、弹窗开+关双向、capture-page 重复采集幂等（二次采集进独立快照、首采证据不变） |
| tests/fixture-site/* | 新增 login-api 端点（POST 校验+Set-Token 响应头）、changed 接口（带版本参数）、missing.css（恒 404） |
| reference/02 §〇 | 三态来源口径扩充为统一枚举：动态实测/静态推断/双轨互证/模拟实现/演示数据——每条证据必须带来源标签 |
| reference/04 | 新增规则：「邻近元素证据不能替代本元素实测」（引用漂移教训）；验证状态枚举（实测通过/骨架待补/部分失败/失败/豁免登记） |
| SKILL.md | 发布口径两条：「同机克隆试装 ≠ 跨平台验证」「SkillHub 提交 ≠ 上架（审核中为独立状态）」 |
| openspec/changes/harden-system-replica-evidence/ | 本方案（proposal/tasks/spec） |

## 兼容性

- capture-page 输出目录行为变更（新增时间戳后缀）属**加法变更**：`--out` 显式指定时行为不变（但非空目录仍拒绝，需 --force）；reference/02、05 模板 B 同步更新用法；
- similarity 新增 FAIL 条件（零配对）会使既有全绿结果不变（正常配对不受影响），但错误配对场景由假 PASS 变 FAIL——预期行为收紧；
- validate 断言从 20 增至约 30+，既有 20 条断言语义不变（阶段 A 换采集器后截图/DOM 产物路径一致）。

## 异常处理

- 脱敏函数对二进制体跳过（仅处理文本类，同现有 BODY_CAP 逻辑）；
- 独立快照目录冲突：非空且无 --force → exit 2 拒绝；
- capture-status.json 损坏/缺失 → 视为 skeleton（保守降级）；
- validate 调用 capture-page 失败 → 该阶段 FAIL 并保留 stderr 摘要（不静默）。

## 验收场景（实施后逐条断言）

1. 采集带 token/手机号的页面 → api/*.json 中对应字段为 ***REDACTED***（脱敏生效）；
2. 同目录二次采集 → 首次快照文件逐字节不变（独立快照）；新快照独立成目录；
3. 带 state 占位与 notes TODO 的产物 → capture-status=skeleton（不算 complete）；补齐后 =complete；
4. 相似度：完全无关文件对 → FAIL（zero-pair）；改名映射文件 → 正常配对计算；报告含 coverage；
5. validate：登录 POST 捕获+脱敏断言、Token 头断言、接口变化检出、404→partial、弹窗开关、重复采集幂等——全部 PASS；
6. 脱敏扫描（既有红线）复跑 0 命中；validate 全绿 exit 0。

## 失败判定

- 任一验收场景断言 FAIL → 实施不通过；
- similarity 对既有达标对（重写合规 7.9%/0% 等）误报 → 算法回归，不通过；
- capture-status 误标 complete（占位产物）→ 不通过；
- 脱敏后数据语义损坏（JSON 不可解析）→ 不通过。

## 回滚方法

- 全部变更为脚本与文档级：`git`/备份恢复 capture-page.mjs、similarity.mjs、validate.mjs、fixture-site、reference/02/04、SKILL.md 至 v1.1.0 状态（实施前先对五个改动文件做 .bak 快照存 UPGRADE 目录）；
- 无数据迁移、无外部依赖变更，回滚即恢复旧行为。

## 母本→发现副本同步校验

实施完成后：`rsync`（排除 tools/validate-output/preflight-report.json）→ `node scripts/sync-check.mjs` 25+/25+ sha256 一致 → 差异清单贴回报。
