# UPGRADE v1.1.0 · 升级实现说明

- 日期：2026-10-18
- 范围：专业评审修复（P0×2 全部 + P1×7 全部 + P2 快赢×4）+ 署名与社区组件 v2.4
- 评审基线：`05_skills/system-1to1-replica-评审报告.md`（只读参考，未改动）
- 验证结论（全部真实执行）：preflight ✅ exit 0；validate ✅ 20/20 断言；add-signature --selftest ✅ 6/6；sync-check 同步后 ✅ 24/24 文件 sha256 一致；脱敏复扫 0 泄漏。

## 一、评审修复清单（逐条证据）

### P0

| 项 | 修法 | 证据 |
| --- | --- | --- |
| P0-1 相似度脚本缺失 | 新建 `scripts/similarity.mjs`：按扩展名剥注释（js/css/html 各自语法，字符串感知状态机）→ 去空行 → difflib 等价最长匹配块（SequenceMatcher 同族）→ **原型行数为分母** → 输出重合率 + ≥7 行重合块逐条清单；`--json` 供脚本消费；退出码 0 达标/1 超线/2 用法错。03/05/06 中「审查方脚本」字样全部改为指向该脚本 | 实测：同文件对比 100%+1 个 38 行块→exit 1；部分重写件 2.6%→exit 0；validate 内置断言「重写合规」实测 app-clone.js 7.9%、styles.css 0% 全过 |
| P0-2 validate 自检盲区 | ①建造阶段同步产出重写版 `styles.css`（紧凑排版+声明重排）与 `app-clone.js`（箭头函数+事件委托+查表渲染，与原实现不同构）并改 HTML 引用；②审查阶段挂 response 监听断言非豁免 4xx/5xx=0（favicon 登记豁免）；③视觉冒烟断言（.stat 计算背景为白色系 rgb(255,255,255)，样式缺失时为透明即 FAIL）；④tab 点击切换+激活态迁移纳入断言 | 断言数 11→20 全绿；开发中曾实测抓到 add-signature 的 `static/static` 双拼路径 404（正是新断言的靶子），修复后 0 异常响应 |

### P1

| 项 | 修法 | 证据 |
| --- | --- | --- |
| P1-1 Windows 路径转义 bug | 删除 `node -e` 拼接，改 `createRequire(tools/package.json)` 本进程内 `chromium.executablePath()` | preflight.mjs 第 30/62 行附近；preflight 重跑 exit 0 |
| P1-2 同步仅 rsync、无校验 | SKILL.md 补 Windows robocopy 等价命令；新建 `scripts/sync-check.mjs`（sha256 清单比对，排除 tools/validate-output/preflight-report.json，自动探测副本） | 实测：同步前列出 7 缺失+10 不一致；rsync 后 24/24 一致 |
| P1-3 教训回流方向矛盾 | SKILL.md「安装与同步」与 reference/06 头部均写明：**母本是唯一编辑点**；项目教训先进项目台账，定期誊回母本，再单向同步副本；sync-check 对「副本多出」文件给出回流提示 | 两文件现文；sync-check 输出实测含提示语 |
| P1-4 preflight/manifest 漂移 | preflight 探测表对齐 manifest：按需层补 mitmdump，深度层补 java(JDK)/gdb/rizin/lldb/unblob（binwalk 检测改 `--help`）；git 口径统一为「core 层 ok/warn 均不计 fail」并在 manifest/脚本双处标注；manifest 删除重复的 apktool 行（动静两轨共用一行） | preflight 实测输出 15 项检测（lldb 命中 OK）；manifest 现 13 行无重复 |
| P1-5 范围诚实声明 | SKILL.md 顶部新增「v1.1 深度支持范围：Web 站点（MPA/SPA/管理后台）与 Electron；桌面原生/移动 App 提供工具矩阵与方法论指导，任务书变体与实证判例待 v1.2 回流」 | SKILL.md 头部第 3 行引言 |
| P1-6 采集无捆绑脚本 | 新建 `scripts/capture-page.mjs`：playwright 打开 URL → 五件套落盘（full.png/dom.html/api 每请求一 JSON/state 占位/notes 骨架自动生成，接口清单自动列出）；支持 --user/--pass/--submit + CAPTURE_USER/CAPTURE_PASS 环境变量；02 §一与 05 模板 B 引用之 | 实测：静态靶场 6 请求落盘成功；fetch 用例 api/001-*.json 含 method/status/responseBody；重定向场景优雅降级 |
| P1-7 触发词缺同义词 | description 补「克隆/仿站/照着做一个/还原/移植」 | SKILL.md frontmatter |

### P2 快赢

| 项 | 修法 |
| --- | --- |
| P2-1 假字段/死代码 | `startedAt: items.length` → `checkedAt: ISO 时间戳`（并写入 report.json）；删除 `report_pass_check:` 空标签块 |
| P2-2 scaffold 幂等矛盾 | 移除非空目录 exit 1，改为真正幂等（已存在跳过、其余创建）；flag 参数（--name）不再误当目录名。实测：二次运行全部跳过。**勘误（终审 FAIL-1）**：初版修复存在差一错误——无 `--name` 时位置参数被静默忽略（`node scaffold.mjs my-project-x` 误建 `./replica-project`），当时的"实测二次运行全部跳过"只覆盖了带 `--name` 路径、未覆盖文档化主用法；已按终审意见修复为 `(nameArgI === -1 \|\| i !== nameArgI + 1)` 并补测两种调用路径（见终验记录） |
| P2-6 binwalk 误报 | 检测命令 `--version` → `--help`（unblob 同） |
| P2-7 browser.json 缺失指引 | validate/capture-page 在 browser.json 缺失/无 executablePath 时直接报错并指向「先跑 preflight」 |

## 二、署名与社区组件 v2.4

- 组件模式源自 **software-decard** 技能 `references/ui-signature.user.js`（右下角胶囊+悬停弹层+QR data URI+静默失败），致谢；本 skill 改造为注入式交付组件。
- 交付物：
  - `assets/signature.json`（author/wechat/github/gitee/pillText/overrides）；
  - `assets/wechat-qr.b64`（用户本人资产，自 software-decard 复制）；
  - `scripts/add-signature.mjs`：README 署名段（幂等标记）+ 全部 .html `</body>` 前注入引用（相对路径，子目录自动回退）+ 生成 `static/signature.js|css`；
  - **风格自适应**：运行时探测优先级 = overrides → 宿主 CSS 变量（--accent/--primary/--primary-color、--text/--foreground、--bg/--background）→ 既有按钮实色/正文色/页面背景（亮度判定深浅色，中性色跳过）→ 中性毛玻璃默认；圆角与字体沿用宿主；
  - `reference/08-署名与社区组件.md`：用法/机制/合规两档/致谢；`reference/07` 新增 §六 署名两档规则；scaffold README 模板内嵌署名指引；SKILL.md 索引加 08、阶段 6 门禁加「署名注入（如用户要求）」。
- 实测证据：
  - validate 断言「署名胶囊注入成功」+「风格自适应：胶囊强调色=宿主按钮色」→ 实测 `rgb(109, 93, 252)` === `rgb(109, 93, 252)`（自适应真生效）；
  - `add-signature --selftest` 6/6：注入点存在、二次注入全跳过、文件内容零变化；
  - 真实项目形态（scaffold 骨架）注入：README appended → 重跑 skipped，组件 unchanged。

## 三、遗留登记（P2 未做项与 v1.2 回流项）

| 项 | 处置 | 理由 |
| --- | --- | --- |
| P2-3 内容重复（授权表/质量指标表双份） | 未做，留 v1.2 | 单一事实源重构涉及多文件口径迁移与索引调整，改动面大；当前两处口径一致且有 sync-check 兜底 |
| P2-4 fixture 扩展（4xx 端点/确认弹窗写操作演练） | 未做，留 v1.2 | 4xx=0 断言已落地（favicon 豁免登记示范了豁免机制）；确认态采集演练需新增靶场端点并与 L2 授权叙事联动，值得独立一批做 |
| P2-5 目录纳入 git | **不做**（登记） | 涉及 .gitignore 策略与版本控制决策，未获用户授权；UPGRADE 文件承担变更记录职能 |
| P2-8 测试 prompt 记录 | 未做，留 v1.2 | 需真实会话回归验证触发率后回填，凭空编写无实证价值 |
| P2-9 npm -g 权限提示 | 部分做 | preflight 提示语已补「或用 npx 免安装运行」；模板 A 口径统一留 v1.2 |
| 桌面/移动五件套变体、任务书桌面变体、二进制相似度口径 | v1.2 回流项 | 按 P1-5 声明的范围机制，待首个实战项目沉淀后经 reference/06 回流 |
