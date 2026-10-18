# 02 · 逆向采集与 RPA（动态 + 静态双轨）

## 〇、双轨定义：动态逆向 vs 静态逆向

| 轨 | 定义 | 类比 | 产出 |
| --- | --- | --- | --- |
| **动态逆向** | RPA **运行目标系统**（浏览器打开/桌面启动/设备安装），真实操作并观测行为：抓包、点击点穿、状态流转、覆盖率 | 站在厨师旁边看炒菜，记下每一步实际操作 | 五件套（截图/DOM/接口抓包/交互状态/notes）、网络行为证据 |
| **静态逆向** | **不运行目标**，下载其代码与包体做分析：JS/ASAR/bundle 静态分析、资源镜像、安装包解包 | 拿到菜谱研究：从文字推断食材、工序、隐藏菜品 | 接口/存储/路由静态清单（带源码行号）、资源镜像、能力边界 |

**双轨交叉印证（铁律，孤证不立）**：
- 动态证明「实际行为」，静态证明「能力边界」——两轨各自有盲区：
  - 只做动态：写操作/隐藏路由因只读红线**永远抓不到**（实证：静态分析从代码挖出 6 个从未触发的写操作接口，含源码行号）；
  - 只做静态：运行时动态拼接的 URL、真实响应数据**拿不到**（实证：老式框架动态拼 URL，静态清单不全，靠动态抓包补齐）；
- 最终接口清单每条标注来源：**动态实测 / 静态推断 / 双轨互证**；复刻后端按清单全量实现。

## 一、动态轨 · 五件套标准（Web 基准，跨平台泛化见 §二）

每个页面五件齐备，缺一不算采集完成：

| 件 | 内容 | 要点 |
| --- | --- | --- |
| 1 整页截图 | fullPage 长图（视口建议 1440×2400） | 等懒加载完成再拍；hash 切换后须整页重载重拍（防旧帧残影） |
| 2 渲染后 DOM | `document.documentElement.outerHTML` 完整存档 | SPA 注意 keep-alive 僵尸视图污染——抽查页面独有文案核验 DOM 身份 |
| 3 接口抓包 | 每个 XHR/fetch 一个 JSON（URL/方法/请求体/响应体/状态码） | 长列表抓 1、2 页推断分页；筛选器每条件点一次看参数变化 |
| 4 交互状态 | 每个弹窗/抽屉/下拉/tab/校验态一张图 | DOM 有变化的同步存子树 .html（复刻时逐字比对文案用） |
| 5 notes.md | 页面作用/入口/跳转/接口清单/交互清单/复刻要点 | **可疑点必须当场核证**（见 §四），不带疑问过夜 |

写操作红线：确认类到确认态即取消；消耗/外发类默认不触发（授权分级见 07）。

落地工具：`node <skill>/scripts/capture-page.mjs <URL> <输出目录> [--user/--pass/--submit + CAPTURE_USER/CAPTURE_PASS]` 一键产出单页五件套骨架（full.png/dom.html/api 每请求一 JSON/state 占位/notes 骨架），交互状态按 notes 清单人工补拍。

## 二、目标类型识别与 RPA 适配矩阵（动静双轨工具选型）

| 目标类型 | 识别特征 | 动态轨工具 | 静态轨工具 | 复刻栈建议 |
| --- | --- | --- | --- | --- |
| Web MPA | 每功能一个 URL、服务端模板、整页刷新 | 浏览器 RPA（playwright/REA capture）+ 抓包 | JS/CSS 镜像 + REA JS 静态分析 | 按原架构（多页静态+轻后端）最易 1:1 |
| Web SPA | hash/无刷新路由、bundle 打包、前端框架 | 同上 + 路由遍历 | **从 JS bundle 提路由表**、隐藏路由清单→动态逐个访问 | 组件栈对齐原框架（Vue→Vue）或按原架构自绘 |
| 管理后台（iframe/多标签） | 主框架+iframe、addtabs | 同 MPA，另采 iframe 内页 | 同 MPA | 同 MPA |
| **Electron 应用** | 安装包含 app.asar / Chromium 内核 | **CDP 直连（重大捷径）**：以 remote-debugging 启动=动态采集 Web 页；REA capture_electron_scenario 可驱动真实应用（点击/重载/IPC 取证） | **解包 app.asar**（REA analyze_javascript_application 直接吃 asar）；inspect_electron_fuses | 复刻为 Web 应用（推荐）或 Electron |
| 桌面原生（macOS） | 非 Chromium 窗口 | 桌面 RPA：无障碍树（AX）+ 截图 + Computer Use；**REA observe_native_calls（LLDB 断点观测真实函数调用与参数）** | 安装包/二进制静态分析（Mach-O/Go/Rust/.NET 各有专用工具） | 复刻为 Web 应用（跨平台、易审查）为主选 |
| 桌面原生（Windows） | 同上 | UIA 自动化树 + 截图 + Computer Use；**进程运行场景捕获（REA capture_process_scenario）** | PE 静态分析 | 同上 |
| 移动 App（Android）｜优先 | APK/包名 | adb+模拟器 RPA + 抓包（REA adb 全家桶：装包/截图/日志/文件） | **apktool 解包 + JADX 静态分析**（REA inspect_android_* 族） | 复刻为 Web/App 按用户需求 |
| 移动 App（iOS）｜有限 | IPA | 模拟器 + 截图 | plist/资源目录静态分析（REA inspect_*） | 同上，登记支持边界 |
| 深度场景 | 需要突破运行时保护/看加密前后数据 | **Frida 运行时插桩（REA frida 会话）**、GDB/Rizin 调试器 | binwalk/unblob 固件解包、EVM 静态分析 | 按需单独立项 |

判定口诀：**先看安装形态（网页/安装包/商店 App），再看内核（Chromium/原生），最后按双轨定工具**。Electron 务必先查——能把桌面采集降维成 Web 采集。

## 二·补、REA 工具映射速查（静态/动态各有什么）

| 轨 | 我们项目用过的 | 同族还有（按目标类型启用） |
| --- | --- | --- |
| 静态 | `analyze_javascript_application`（JS/ASAR，endpoint/storage/模块图带源码行号） | 二进制布局/Mach-O/Go/Rust/.NET/WASM 静态分析、APK 静态族（JADX/apktool/资源解码/引用追溯）、固件识别与解包、苹果静态族（plist/签名/资源目录/键值归档）、EVM 字节码、版本对比族 |
| 动态 | `capture_browser_scenario`（真开浏览器执行动作+全量抓包+截图）、`inspect_web_page`（活页面观测） | **Electron 驱动**（点击/重载/崩溃/IPC）、**进程运行场景**（PTY+交互+文件系统+退出码）、**原生窗口点击**、**LLDB 断点观测函数调用与参数**、**Frida 插桩会话**、GDB/Rizin 调试、Android 真机/模拟器全家桶、活页面执行覆盖率、进程捕获对比 |

选用原则：**动态轨永远先行**（先跑起来看行为），静态轨补盲（能力边界+写操作+隐藏路由）；深度层工具（Frida/调试器/固件）只在目标类型需要时启用并征得确认。

## 三、采集通道与工具

| 通道 | 首选 | 兜底 |
| --- | --- | --- |
| 浏览器 RPA | REA capture（CDP 场景：network 请求体+响应体、events、逐步截图） | playwright-core + 本机 Chrome（headless） |
| JS 静态分析 | REA CLI `analyze-javascript-application`（endpoint/storage/模块图） | grep 上下文正则交叉（动态拼接 URL 场景 REA 有盲区，必须交叉） |
| 接口重放验证 | curl + cookie jar | playwright request |
| 桌面 RPA | 无障碍树读取 + Computer Use | 系统级截图 + 坐标操作（最后手段，脆） |
| 流量抓包 | REA inspect（tshark/mitmproxy 格式） | 浏览器 DevTools 导出 HAR |

通道缺失处理：preflight 自动装核心件；MCP 未注册→自动回落 playwright 脚本（能力等价，口径一致）；安装动作遵守 deps-manifest 分层授权。

## 四、采集陷阱防御（每条都有实证判例，逐条执行）

1. **timeout ≠ noop**：「点了没反应」必须查点击日志的 result 字段——`TimeoutError` 被误读成"无响应"曾导致复刻行为反向（判例：切组下拉实为服务端重拉）。对策：任何「零请求/无响应」结论，三证互洽（点击日志 + 截图校验和 + 源码）。
2. **选择器口径误读**：枚举可点元素时选择器窄于实现（只找 button/a 漏 span）会得出「元素不存在」的假结论（判例：翻页器为 span 结构被漏采）。对策：枚举后与渲染 DOM 直接 diff，不依赖单一选择器。
3. **壳页 ≠ 空壳**：跳转壳（meta refresh/JS replace/几行 location.replace）看起来像"待渲染空页"，实际是入口路由（判例：三个"空壳页"实为跳转到别的页签）。对策：先看源文件全文再定性。
4. **同名不同产品**：同Nom产品不同部署毫无代码关系（判例：两个同名 GEO 系统，技术栈完全不同）。对策：以登录页特征、静态资源指纹、接口前缀三处核实身份。
5. **账号状态污染样例**：服务端累计型状态（如登录失败计数）会让"新鲜态文案"失真（判例：锁定阈值 5 次被采成 3 次）。对策：涉及计数的契约，用全新会话复测。
6. **DOM 身份核验**：hash 原地切换截图会拍到旧帧；SPA 僵尸视图污染 DOM。对策：每页抽查独有文案证明 DOM 与截图同源。
7. **版本漂移**：目标系统活跃迭代时，采集期间版本可能变。对策：GOAL 登记版本快照；发现差异走增量重抓（旧文件加日期后缀，绝不覆盖）。
8. **敏感信息即刻脱敏**：抓包响应里出现真实 key/token/手机号的，当场脱敏（***REDACTED***），并扫描历史产出连带修复（判例：采集产出混入真实引擎 key）。
9. **懒加载**：不滚动到底就抓，会漏内容漏接口。对策：滚动到底触发后再抓 DOM 与接口。
10. **写操作授权**：L2/L3 操作严格遵守授权分级（07 §一）；误触写操作的按"测试产生"登记并评估影响。

## 五、增量重抓规则

- 已抓页面重抓：旧文件加日期后缀保留（`screenshot-20261007.png`），绝不覆盖；
- 新页面按现有序号顺延；
- 目标系统改版：先在台账登记「版本快照」行，再动手重抓；
- 重抓后与旧版做 diff，差异写进复刻分析。
