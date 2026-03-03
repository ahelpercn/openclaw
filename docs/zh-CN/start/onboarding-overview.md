---
summary: "OpenClaw 新手引导选项和流程概览"
read_when:
  - 选择引导路径
  - 设置新环境
title: "新手引导概览"
sidebarTitle: "新手引导概览"
---

# 新手引导概览

OpenClaw 支持多种引导路径，具体取决于 Gateway 网关的运行位置以及您偏好的提供商配置方式。

## 选择您的引导路径

- **CLI 向导** 适用于 macOS、Linux 和 Windows（通过 WSL2）。
- **macOS 应用** 适用于在 Apple 芯片或 Intel Mac 上进行引导式首次运行。

## CLI 新手引导向导

在终端中运行向导：

```bash
openclaw onboard
```

当您需要完全控制 Gateway 网关、工作区、渠道和 Skills 时，请使用 CLI 向导。文档：

- [新手引导向导（CLI）](/start/wizard)
- [`openclaw onboard` 命令](/cli/onboard)

## macOS 应用引导

当您希望在 macOS 上获得全程引导式设置时，请使用 OpenClaw 应用。文档：

- [新手引导（macOS 应用）](/start/onboarding)

## 自定义提供商

如果您需要未列出的端点（包括暴露标准 OpenAI 或 Anthropic API 的托管提供商），请在 CLI 向导中选择**自定义提供商**。您需要：

- 选择 OpenAI 兼容、Anthropic 兼容或**未知**（自动检测）。
- 输入基础 URL 和 API 密钥（如果提供商要求）。
- 提供模型 ID 和可选别名。
- 选择端点 ID，以便多个自定义端点可以共存。

详细步骤请参考上方的 CLI 引导文档。
