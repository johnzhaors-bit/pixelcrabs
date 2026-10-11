<p align="center">
  <img src="docs/images/pixelcrabs-logo.png" width="240" alt="PixelCrabs 标志">
</p>

<h1 align="center">PixelCrabs</h1>

<p align="center"><strong>有想法，就把它做出来。</strong></p>

<p align="center">
  基于 OpenCode 构建的开源、本地优先可视化 AI 开发工作台。
  描述应用、查看真实运行结果、指出需要修改的位置，并持续迭代真实源码。
</p>

<p align="center">
  <a href="https://pixelcrabs.com">官方网站</a> ·
  <a href="https://pixelcrabs.com/updates/">更新记录</a> ·
  <a href="README.md">English</a>
</p>

> 这是 PixelCrabs 新的官方开源仓库，已包含经过文件级审计的 Web 优先源码快照。希望直接体验完整桌面产品，请访问官方网站。

## 为什么选择 PixelCrabs？

多数 AI 编程工具理解文件，PixelCrabs 还帮助你从真实运行界面继续开发：

- **成熟的 Agent 底座**：OpenCode 负责会话、模型、工具、权限和源码修改。
- **真实项目预览**：查看应用实际开发运行态，而不是一次性效果图。
- **点选、框选和多选**：把界面反馈转换成结构化证据，交回同一个编程 Agent。
- **项目保留在本地**：源码仍在自己的项目目录，可继续使用 Git 和常规开发工具。
- **模型自由**：连接受支持的供应商、自有 API Key、本地或企业兼容服务。
- **可扩展能力**：通过 Skill、MCP 和专门工具扩展工作流，不再建立第二套 Agent。

## 工作流程

```text
描述目标
  ↓
OpenCode 在真实项目中开发
  ↓
PixelCrabs 启动并展示开发运行态
  ↓
点选界面元素或框选区域并补充要求
  ↓
Evidence 回到同一个 Agent 会话
  ↓
修改源码、刷新预览并重新检查结果
```

## 开源范围

公开版首先聚焦 Web 开发，供开发者研究、修改和自行运行本地工作流。

| 领域 | 公开方向 |
| --- | --- |
| 编程底座 | 固定版本的 OpenCode 源码，保留上游许可证与署名 |
| Web 项目 | 项目识别、本地开发运行、预览与可视反馈 |
| 模型 | 用户自行配置供应商、API Key 和兼容本地服务 |
| Skill 与工具 | 本地 Skill、MCP 和经过审查的扩展接口 |
| 交付 | 使用自己的工具与托管服务完成本地构建和导出 |
| Flutter | Web 工作流稳定后继续推进 |

PixelCrabs 托管账号、平台模型凭证与计费、云托管、市场运营、私有管理服务、商业资源和专用发布集成不属于本仓库。

## 当前状态

本仓库使用全新的公开历史重新开始。当前源码快照来自旧公开仓库最后一个公开提交，并包含：

- `upstream/opencode` 中固定版本的 OpenCode 引擎源码；
- `packages/local-runtime` 中的本地 Web 运行、预览网关与静态导出基础；
- `packages/platform-desktop` 中的通用桌面系统网络桥接；
- 公开测试与 Linux 冒烟测试工作流。

可直接使用的商业桌面版仍然单独分发。本仓库是源码优先的公开版，不包含 PixelCrabs 平台服务。

## 快速开始

安装 **Node.js 24 或更高版本** 后，可在仓库根目录预览可信的静态网站：

```sh
node packages/local-runtime/bin/static-preview.mjs /你的/网站/绝对路径
```

目标目录必须包含 `index.html`。打开终端输出的本地地址，按 **Ctrl+C** 停止。React、Vue、Next.js、Nuxt、Astro 等框架项目应使用自身开发服务器。

如需运行固定版本的 OpenCode 引擎，请安装 **Bun 1.3.14** 并使用保留的锁文件：

```sh
cd upstream/opencode
bun install --frozen-lockfile
bun dev --help
bun dev /你的/项目/绝对路径
```

无需安装依赖即可运行公开运行时的基础测试：

```sh
node --test packages/local-runtime/test/public-preview-core.test.mjs \
  packages/local-runtime/test/public-static-preview.test.mjs \
  packages/local-runtime/test/public-web-project.test.mjs \
  packages/local-runtime/test/public-web-runtime.test.mjs \
  packages/local-runtime/test/public-preview-gateway.test.mjs
```

[CI 工作流](.github/workflows/opencode-smoke.yml)记录了需要锁定依赖的完整构建与测试顺序；其中部分测试需要下载依赖和本机编译工具链。

## 安全与隐私

- 禁止提交 API Key、Token、证书、Cookie 或私有项目内容。
- “本地优先”不代表所有模型都离线运行；使用在线模型时，请求所需上下文会发送给相应供应商。
- 模型的可用性、价格、数据保留和能力由用户选择的供应商决定。
- 发现安全问题时，请按照 [SECURITY.md](SECURITY.md) 私下报告。

## 参与贡献

欢迎提交可复现的问题、聚焦的改进，以及围绕公开 Web 工作流的讨论。提交 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 上游与许可证

PixelCrabs 基于 [OpenCode](https://github.com/anomalyco/opencode) 构建。OpenCode 和其他依赖继续使用各自的版权、许可证和 Notice，来源规则见 [NOTICE.md](NOTICE.md)。

本公开仓库中由 PixelCrabs 编写的代码默认使用 [MIT License](LICENSE)，另有声明的文件或组件除外。本仓库的 MIT 许可证不覆盖未公开的 PixelCrabs 服务、私有源码、商标及单独分发的第三方资源。

---

<p align="center"><strong>你的想法，你的代码，你的模型。</strong></p>
