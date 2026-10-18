#!/usr/bin/env node
/* scaffold.mjs — 创建标准复刻项目骨架
 * 用法：node scaffold.mjs <项目目录> [--name 项目名]
 * 幂等：已存在文件跳过不覆盖、其余创建（可对既有骨架补齐）；flag 参数（如 --name）不会误当目录名。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const nameArgI = args.indexOf('--name');
const NAME = nameArgI > -1 && args[nameArgI + 1] ? args[nameArgI + 1] : null;
const targetArg = args.find((a, i) => !a.startsWith('-') && (nameArgI === -1 || i !== nameArgI + 1));
const target = path.resolve(targetArg || './replica-project');
const projectName = NAME || path.basename(target);

const dirs = ['docs/审查', 'docs/建造', '逆向采集/01_入口与登录', '逆向采集/02_页面', '逆向采集/03_接口', '逆向采集/04_前端资源', '逆向采集/05_交互状态', '逆向采集/06_本地存储', 'frontend/static', 'mockserver'];
dirs.forEach(d => fs.mkdirSync(path.join(target, d), { recursive: true }));
const W = (rel, content) => { const p = path.join(target, rel); if (fs.existsSync(p)) { console.log(`跳过（已存在）${rel}`); return; } fs.writeFileSync(p, content); console.log(`创建 ${rel}`); };

W('说明文档.md', `# ${projectName} · 说明文档（进度台账 · 唯一断点事实源）

## 项目规划
- 目标：【目标系统名 + 地址 + 类型】
- 总纲：docs/GOAL-计划.md
- 事实源：逆向采集/ 目录
- 账号：.env（禁止提交/外传/写入文档）

## 实施方案
- 按 skill「系统1比1复刻」六阶段执行；子智能体默认串行。

## 进度记录

| 日期 | 进度 |
| --- | --- |
| ${new Date().toISOString().slice(0, 10)} | 创建项目骨架（scaffold） |
`);

W('docs/GOAL-计划.md', `# ${projectName} 1:1 复刻 · GOAL 计划（模板——逐节填写后请用户批准）

## 一、目标系统概况
- 地址/形态：【URL 或安装包】
- 技术栈判定：【Web MPA / SPA / Electron / 桌面原生 / 移动】（证据：）
- 与已有材料是否同一产品：【三处特征核实结论】
- 版本快照：【vX.Y.Z @ 日期】

## 二、目标与非目标
（功能 1:1 / UI 1:1 / 接口等价 / 审查闭环；非目标：服务端源码、真实第三方对接、对外发布商用）

## 三、已确认决策（逐项与用户确认）
1. 复刻栈：【按原架构 / 对齐原框架 / 复刻为 Web】
2. 推进方式：【分 N 期 M 批】
3. 后端深度：【模拟数据+真实 CRUD；AI/支付/外发一律模拟】
4. 特殊能力：【RPA/外设类 UI 1:1 + 状态流转模拟】
5. 采集授权级别：【L0-L1 / L2 / L3】
6. 署名交付口径：【复刻对标不署名（默认）/ 以本人原创作品名义交付时注入署名（reference/08）】

## 四、分期分批表
| 期 | 批 | 范围 | 页数 |

## 五、质量闭环
建造/审查分离；每批静态对照+交互实测+定向复验；终验=全站逐按钮 inventory（FAIL=0）+ 全站回归 + 总验收报告。

## 六、批准记录
- 【日期】用户批准（含决策确认）
`);

W('.env.example', `# 目标系统采集账号（复制为 .env 使用；禁止提交/外传）
TARGET_URL=
TARGET_USER=
TARGET_PASS=
`);

W('.gitignore', `.env
账号.env
node_modules/
data.db
uploads/user/
.DS_Store
*.log
`);

W('README.md', `# ${projectName}

> 1:1 复刻项目 · 仅供内部对标学习，不对外发布、不商用。

## 快速开始
1. 复制 \`.env.example\` 为 \`.env\` 并填写（禁止提交/外传）；
2. 按 skill reference/01 从阶段 1 摸底开始；
3. 进度以「说明文档.md」台账为唯一断点事实源。

<!-- 署名段：运行 \`node <skill目录>/scripts/add-signature.mjs <frontend交付目录>\` 注入（仅限用户要求或以本人原创作品名义交付时，勿手改） -->
`);

console.log(`\n✅ 骨架就绪：${target}
下一步：①填 .env（从 .env.example 复制）；②按 skill reference/01 阶段 1 摸底并填写 GOAL；③批准后进入阶段 2 采集；
④（可选）用户要求署名或以本人原创作品名义交付时，收尾运行 add-signature.mjs 注入署名与社区组件（见 reference/08）。`);
