# 逆向系统复刻工程师 · 系统 1:1 复刻（system-1to1-replica）

> 一套对任何目标系统做 1:1 复刻的完整方法论 + 可执行工具链，覆盖 Web 站点（MPA/SPA/管理后台）与 Electron 桌面软件；桌面原生 / 移动 App 提供工具矩阵与方法论指导。
> 沉淀自一个 22 小时、11 建造批次、284 条终验断言全部通过的完整复刻项目。版本 1.2.2。
> v1.2 采集证据加固：采集自动脱敏（含 DOM/内联脚本/请求响应）、独立快照 + 完成度状态机、相似度零配对护栏、validate 升级为 37 断言；Skill 显示名更名「逆向系统复刻工程师」（仓库名不变）。变更详情见 [`UPGRADE-v1.2.md`](UPGRADE-v1.2.md)。

## 这是什么

「复刻」不是截几张图照着画。本 skill 把**可验收的 1:1 复刻**定义为一个可度量、可审查、可断点续跑的工程过程，核心是三根支柱与一条质量闭环：

### 三支柱（交付定义，缺一不算复刻完成）

| 支柱 | 含义 | 验收口径 |
| --- | --- | --- |
| ① RPA 驱动双轨逆向 | **动态逆向**（RPA 运行目标系统，观测真实行为：抓包 / 点穿 / 状态流转）+ **静态逆向**（不运行目标，分析代码与包体：JS / 资源 / 接口边界），双轨交叉印证、孤证不立 | 每页五件套齐备；接口清单双源交叉；隐藏能力有代码级证据 |
| ② UI 交互页面 1:1 | 复刻页与原页对照通过：布局 / 文案逐字 / 配色 / 组件形态 / 图标 | 静态对照审查 pass；截图 / 结构比对零重大差异 |
| ③ 功能交互逻辑可运行 | 不是截图还原——每个功能在复刻后端下端到端跑得通 | 逐功能演示 + 全站逐按钮 inventory 核对 FAIL=0 + 0 pageerror |

### 六阶段流程（每阶段有门禁）

```
0 环境自检 → 1 摸底定计划 → 2 动态采集（每页五件套）→ 3 静态逆向（双轨交叉）
→ 4 分批建造（结构性重写，相似度 <40%）→ 5 独立审查 + 返工闭环 → 6 终验归档（全站逐按钮盘点）
```

### 质量闭环（硬阈值）

- 代码相似度（剥注释 + LCS）：**<40%** 且无 ≥7 行成段业务逻辑重合——复刻必须结构性重写，不是照抄
- 页面错误 **0 pageerror**；非豁免 4xx/5xx = 0
- 全站逐按钮 inventory：复刻缺陷 **FAIL = 0**
- 终验回归：全部套件断言 **100% 通过**
- 建造与审查**分离**：审查由未参与建造的子智能体执行，审查不通过不算完成

完整的硬性红线（10 条）、阶段门禁、任务书模板与教训清单见 [`SKILL.md`](SKILL.md) 与 [`reference/`](reference/) 目录。

## 快速开始（新机器三步）

依赖：Node.js ≥ 20（建议 24+）。不需要手动 npm install——preflight 会自动安装缺的依赖。

```bash
# 1. 环境自检 + 依赖自动安装（幂等，可重复跑；缺什么装什么，装完回读验证）
node scripts/preflight.mjs

# 2. 创建标准复刻项目骨架（GOAL 计划、目录约定、进度台账一次就位）
node scripts/scaffold.mjs <项目目录名>

# 3. 想先验证本 skill 在这台机器端到端可用（对内置演练靶场跑迷你复刻闭环）：
node scripts/validate.mjs
```

三步全绿后，按 [`SKILL.md`](SKILL.md) 的六阶段流程开工即可。

## 演示靶场说明

`tests/fixture-site/` 是一个**自建的演示站**（登录页 + 工作台 + 弹窗 + 演示 API），仅作为端到端自检的靶场：

- `validate.mjs` 对它执行「采集 → 建造 → 审查」迷你闭环（37 断言），覆盖采集五件套抽样与自动脱敏、复刻产物白标与重写合规（similarity <40%）、视觉冒烟、tab 行为、署名组件风格自适应、非豁免 4xx=5xx=0、0 pageerror；
- 靶场与任何真实目标系统无关，不含真实域名、账号或数据；
- 运行产物（截图 / 复刻副本 / 报告）落在 `tests/validate-output/`，不入版本库（见 `.gitignore`）。

## 跨机部署

skill 母本只需一份，可同步到任意机器的 Agent 发现路径：

```bash
# macOS / Linux（排除运行产物 tools/ 与 tests/validate-output/）
rsync -a --exclude tools --exclude tests/validate-output --exclude preflight-report.json \
  <本仓库检出目录>/ ~/.agents/skills/system-1to1-replica/

# Windows（PowerShell/cmd；退出码 <8 即成功）
robocopy "<本仓库检出目录>" "%USERPROFILE%\.agents\skills\system-1to1-replica" /E /XD tools validate-output /XF preflight-report.json
```

新电脑上的完整就绪流程：拷贝目录 → `node scripts/preflight.mjs`（自动装依赖）→ `node scripts/validate.mjs`（端到端自检）→ 开工。
修改母本后用 `node scripts/sync-check.mjs [副本路径]` 做全量 sha256 比对，防止副本漂移。

## 目录结构

```
├── SKILL.md              # 技能入口：三支柱 / 六阶段 / 硬性红线 / 质量指标 / 执行模式
├── reference/            # 8 篇参考：阶段流程、逆向采集与 RPA、建造规范、审查闭环、任务书模板、教训清单、合规安全、署名组件
├── scripts/              # 工具链：preflight（环境自检+装依赖）/ scaffold（骨架）/ validate（端到端自检 37 断言）/ similarity（相似度审查+零配对护栏）/ capture-page（采集+自动脱敏+独立快照+完成度状态机）/ sync-check（跨机一致性）/ add-signature（署名组件注入）
├── assets/               # 署名组件素材（signature.json + 微信群二维码）
├── tests/fixture-site/   # 内置演示靶场（自建演示站 + 演示 API，供 validate 使用）
├── openspec/             # 变更记录（OpenSpec：proposal / tasks / review）
├── UPGRADE-v1.1.md       # v1.1 变更记录
└── UPGRADE-v1.2.md       # v1.2 变更记录（采集证据加固 + 更名）
```

## 链接指引

- **本仓库（完整版）**：
  - GitHub：<https://github.com/simonsxxs/system-1to1-replica>
  - Gitee 镜像：<https://gitee.com/simonsxx/system-1to1-replica>
- **SkillHub 科普版**：《系统对标复刻方法论与质量手册》——面向纯知识阅读的姊妹版，只讲方法论与质量闭环，不含操作工具链；上架审核通过后可技能搜索 `system-replica-playbook` 获取（链接待补）。

> 完整版（本仓库）包含可执行工具链；科普版适合先了解方法论再决定是否上工具。

## License

[MIT](LICENSE)

<!-- signature-block:v2.4（本段由 system-1to1-replica/scripts/add-signature.mjs 管理，勿手改） -->

---

## 关于作者

- **作者**：simon，一个不懂代码的AI极客
- **微信交流群**：simonsxxs
- **GitHub**：<https://github.com/simonsxxs>
- **Gitee**：<https://gitee.com/simonsxx>
