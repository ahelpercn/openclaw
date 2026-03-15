---
summary: "社区插件：质量标准、托管要求和 PR 提交流程"
read_when:
  - 您想发布第三方 OpenClaw 插件
  - 您想提交插件到文档列表
title: "社区插件"
---

# 社区插件

此页面跟踪高质量的**社区维护插件**。

我们接受添加社区插件的 PR，前提是它们满足质量标准。

## 列入要求

- 插件包已发布到 npmjs（可通过 `openclaw plugins install <npm-spec>` 安装）。
- 源代码托管在 GitHub（公开仓库）。
- 仓库包含设置/使用文档和 Issue 追踪器。
- 插件有明确的维护信号（活跃维护者、近期更新或及时响应的 Issue 处理）。

## 如何提交

提交 PR 将您的插件添加到此页面，需包含：

- 插件名称
- npm 包名
- GitHub 仓库 URL
- 一句话描述
- 安装命令

## 审核标准

我们倾向于实用、有文档且安全可靠的插件。低质量包装、所有权不明或缺乏维护的包可能会被拒绝。

## 候选格式

添加条目时请使用此格式：

- **插件名称** — 简短描述
  npm: `@scope/package`
  repo: `https://github.com/org/repo`
  install: `openclaw plugins install @scope/package`

## 已列入的插件

- **WeChat** — 通过 WeChatPadPro（iPad 协议）将 OpenClaw 连接到微信个人账号。支持文本、图片和文件交换，通过关键词触发对话。
  npm: `@icesword760/openclaw-wechat`
  repo: `https://github.com/icesword0760/openclaw-wechat`
  install: `openclaw plugins install @icesword760/openclaw-wechat`
