# plugin-hub-plugin

面向 **DeepSeek Harness（DSH）桌面端**的第三方插件板，将四类工具能力封装在同一个 bundle 中，并在宿主原生“包含的组件”面板提供独立开关。

| 组件 | 功能 |
| --- | --- |
| 持久 Shell | PowerShell / Bash 跨调用保持变量、环境和会话状态，按 Agent 隔离 |
| Git 分支与 worktree | 创建独立 Git 分支与工作树，为任务准备工作目录 |
| Codex 子智能体 | 使用官方 Codex CLI 执行外部子任务，复用用户自行完成的登录 |
| Claude Code 子智能体 | 使用官方 Claude Agent SDK 执行外部子任务，需要用户自行完成 CLI 登录 |
| 核心与检验 | 插件目录检查、版本兼容检查、装配冲突检查及带备份的部署计划 |

当前版本：**0.1.2**。DSH 只登记本体一个 bundle，四个功能组件和核心均属于本体；它们各自管理运行资源。关闭核心检验不会关闭其他组件，关闭一个功能组件也不会替换宿主原有工具或其他插件。

## 环境与兼容性

- Node.js 22 或更高版本。
- 离线 release 为 **Windows x64**，包含本插件的 JavaScript 依赖、Codex 与 Claude 平台运行文件。DSH、Node.js、Git、PowerShell 和登录凭据由使用者提供。
- Windows 上的 Bash 使用 Git Bash，可通过 `PLUGIN_HUB_BASH_PATH` 指定可执行程序；否则从系统程序目录发现。
- 当前桌面运行验证基于 DSH `0.2.0-rc.2`；部分模块来自 `0.2.1-alpha.2`，提供 API 适配分支。未来完整桌面版本尚未独立验证。宿主必须提供 PTY、子进程、沙箱和子智能体等服务。

## 使用离线 release

解压 `plugin-hub-plugin-v0.1.2-windows-x64.zip`，进入其中的 `plugin-hub-plugin` 目录：

```powershell
node scripts/verify-release.mjs
node scripts/restore-runtime.mjs
node scripts/load-test.mjs
node --test tests/*.test.mjs
```

先核验 release 文件哈希，再恢复依赖链接。恢复脚本只操作解压目录，不联网、不读取登录凭据、不改动 DSH profile。可重复执行；如果挂载位置被其他文件占用，会停止。

在 DSH 的插件管理入口安装该目录 bundle，确认结果为 `application: applied`，再通过 Cordis Inspect 核查配置和工具。以宿主实际返回为准；`changed: true` 本身不等于已激活。替换已加载的 JavaScript 后应重启桌面端。

也可使用随包 CLI 生成部署计划。将 `<profile-dir>` 替换为目标 DSH profile 的实际目录：

```powershell
node scripts/deploy.mjs --profile "<profile-dir>"
node scripts/deploy.mjs --profile "<profile-dir>" --apply
```

`--apply` 才写入：先备份，然后保留原有字段，仅增加一个本体 dependency、一个 bundle 和目录 SymbolicLink。Windows 创建该 SymbolicLink 需要系统已允许此操作；本插件不会更改系统策略。之后按宿主要求更新 profile 锁文件并重启。不要单独安装内部组件包；不要把已经运行的挂载改指另一份目录。

插件详情页应显示上述五个组件。持久 Shell 包含 PowerShell/Bash 两种实现，因此四类功能对应七个内部模块。

## 从仓库运行

GitHub 源码目录不含大型 CLI 二进制与 `node_modules`。安装已锁定依赖时会访问包源并下载第三方运行文件；希望离线使用时请选择 release ZIP。

```powershell
pnpm install --frozen-lockfile --ignore-scripts
node scripts/restore-runtime.mjs
pnpm run build
pnpm test
```

本仓库直接维护适配后的 JavaScript，不包含上游完整构建树。`build` 执行适配与导入门禁。

## 主要工具

`plugin_hub_pwsh`、`plugin_hub_bash`、`plugin_hub_create_worktree`、`subagent_codex`、`subagent_claude_code`；检验工具为 `plugin_hub_scan`、`plugin_hub_compose`、`plugin_hub_deploy`。

外部模型调用遵循对应产品的登录、权限与计费。release 不包含账户、令牌、会话、用户路径、运行日志或 profile 配置；正常运行默认不写自动验收快照。用户主动执行测试或部署时，会在本地生成测试数据或备份，请勿提交这些文件。

验证范围与已知限制见 [发布验证说明](docs/RELEASE_VALIDATION.md)。变更见 [CHANGELOG](CHANGELOG.md)，上游及第三方许可见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。
