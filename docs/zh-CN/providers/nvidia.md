---
summary: "在 OpenClaw 中使用 NVIDIA 的 OpenAI 兼容 API"
read_when:
  - 您想在 OpenClaw 中使用 NVIDIA 模型
  - 您需要设置 NVIDIA_API_KEY
title: "NVIDIA"
---

# NVIDIA

NVIDIA 在 `https://integrate.api.nvidia.com/v1` 提供 OpenAI 兼容 API，支持 Nemotron 和 NeMo 模型。使用 [NVIDIA NGC](https://catalog.ngc.nvidia.com/) 的 API 密钥进行认证。

## CLI 设置

导出密钥后，运行新手引导并设置 NVIDIA 模型：

```bash
export NVIDIA_API_KEY="nvapi-..."
openclaw onboard --auth-choice skip
openclaw models set nvidia/nvidia/llama-3.1-nemotron-70b-instruct
```

如果仍使用 `--token`，请注意它会出现在 shell 历史记录和 `ps` 输出中；建议尽可能使用环境变量。

## 配置片段

```json5
{
  env: { NVIDIA_API_KEY: "nvapi-..." },
  models: {
    providers: {
      nvidia: {
        baseUrl: "https://integrate.api.nvidia.com/v1",
        api: "openai-completions",
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: "nvidia/nvidia/llama-3.1-nemotron-70b-instruct" },
    },
  },
}
```

## 模型 ID

- `nvidia/llama-3.1-nemotron-70b-instruct`（默认）
- `meta/llama-3.3-70b-instruct`
- `nvidia/mistral-nemo-minitron-8b-8k-instruct`

## 备注

- 使用 OpenAI 兼容的 `/v1` 端点；需要 NVIDIA NGC 的 API 密钥。
- 设置 `NVIDIA_API_KEY` 后提供商自动启用；使用静态默认值（131,072 token 上下文窗口，4,096 最大 token）。
