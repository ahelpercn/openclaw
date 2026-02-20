# OpenClaw 百度语音扩展（中文）

该扩展用于把百度语音设备接入 OpenClaw，实现中文语音指令、设备通知和远程控制。

## 功能

- 设备上下线状态通知
- 语音指令转发到 OpenClaw
- 独立 TTS 播报（仅百度 WS 协议）
- 设备重连与健康检查

## 环境变量

可参考同目录的 `.env.example`：

- `BAIDU_APP_ID`：百度应用 ID（必填）
- `BAIDU_AK`：百度 AK（可选）
- `BAIDU_SK`：百度 SK（可选）
- `OPENCLAW_GATEWAY_URL`：OpenClaw Gateway 地址（默认 `http://localhost:18789`）
- `OPENCLAW_ADMIN_USER_ID`：管理员用户 ID（用于通知）
- `OPENCLAW_NOTIFY_CHANNELS`：通知渠道，逗号分隔（默认 `telegram`）

## 本地开发

在仓库根目录执行：

```bash
pnpm install
pnpm --filter @openclaw/baidu-voice build
```

## 常用命令

- `baidu-status`：查看设备状态
- `baidu-devices`：查看设备列表
- `baidu-tts`：独立 TTS 播报（百度 WS）
- `baidu-speak`：兼容别名（等同 `baidu-tts`）
- `baidu-reconnect`：重连指定设备
