# plugin-hub-plugin v0.1.2

DSH 桌面插件板：在一个 bundle 内提供持久 PowerShell/Bash、Git worktree、Codex 子智能体和 Claude Code 子智能体，并在宿主原生面板展示四个功能组件及核心检验组件。

此次发布材料包含适配后的 JavaScript 源码、文档、回归测试和 Windows x64 离线 ZIP。离线包提供相对依赖清单，解压后运行恢复脚本即可在新目录建立本地依赖关系；不会引用开发机器的安装目录。

发布验证：12 个入口导入、28 个回归用例、真实宿主五组件激活、五项组件开关与五项离线功能检查通过。ZIP 解压、文件哈希与脱敏检查的结果见 `release-validation.json`。仓库工作流已提供，尚未在 GitHub 上执行。

Claude 在线调用需用户自行登录后验收；未来完整 DSH 桌面版本与自动视觉检查仍未验证。账号、令牌、会话、profile、运行日志和构建机器路径不进入发布材料。

附件：`plugin-hub-plugin-v0.1.2-windows-x64.zip` 与 `SHA256SUMS`。使用前参照 README，保留已有插件装配；本项目不自动改变系统权限策略。
