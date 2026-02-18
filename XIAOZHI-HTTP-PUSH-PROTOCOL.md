# xiaozhi-esp32 HTTP 远程推送协议

## 概述

HTTP 推送协议允许 OpenClaw 通过 HTTP POST 请求向 xiaozhi-esp32 设备发送消息，无需保持长连接。适用于远程提醒、跨网络通知等场景。

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      OpenClaw 平台                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Cron System │  │ Agent Tools  │  │   Gateway    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│  ┌──────┴──────────────────┴──────────────────┴───────┐    │
│  │         HTTP Push Client                            │    │
│  │  - Device URL Registry                              │    │
│  │  - Message Queue                                    │    │
│  │  - Retry Logic                                      │    │
│  └─────────────────────────────────────────────────────┘    │
└────────────────────────────┬────────────────────────────────┘
                             │
                    HTTP POST (公网/内网)
                             │
┌────────────────────────────┴────────────────────────────────┐
│                   xiaozhi-esp32 设备                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              HTTP Server (ESP32)                     │   │
│  │  - POST /api/notify    (接收通知)                    │   │
│  │  - POST /api/tts       (播放语音)                    │   │
│  │  - POST /api/mcp       (MCP 命令)                    │   │
│  │  - GET  /api/status    (设备状态)                    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## HTTP API 规范

### 1. 设备端 API（xiaozhi-esp32 提供）

#### 1.1 接收通知

**端点**: `POST /api/notify`

**请求头**:

```
Content-Type: application/json
Authorization: Bearer <device-token>
```

**请求体**:

```json
{
  "notification_id": "notif-123",
  "priority": "high",
  "content": {
    "text": "会议提醒：3点钟有会议",
    "tts": true,
    "led_effect": "pulse_blue",
    "duration_ms": 5000
  },
  "timestamp": 1738656000000
}
```

**响应**:

```json
{
  "status": "ok",
  "notification_id": "notif-123",
  "received_at": 1738656000100
}
```

**错误响应**:

```json
{
  "status": "error",
  "error": "device_busy",
  "message": "设备正在播放音频"
}
```

#### 1.2 播放 TTS 语音

**端点**: `POST /api/tts`

**请求体**:

```json
{
  "text": "这是要播放的文本",
  "voice": "zh-CN-XiaoxiaoNeural",
  "rate": 1.0,
  "volume": 0.8,
  "interrupt": false
}
```

**响应**:

```json
{
  "status": "ok",
  "duration_ms": 2500
}
```

#### 1.3 MCP 命令执行

**端点**: `POST /api/mcp`

**请求体**:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "self.light.set_rgb",
    "arguments": {
      "r": 255,
      "g": 0,
      "b": 0
    }
  },
  "id": 1
}
```

**响应**:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "灯光已设置为红色"
      }
    ],
    "isError": false
  }
}
```

#### 1.4 查询设备状态

**端点**: `GET /api/status`

**响应**:

```json
{
  "device_id": "xiaozhi-001",
  "online": true,
  "state": "idle",
  "battery": 85,
  "wifi_rssi": -45,
  "uptime_seconds": 86400,
  "features": {
    "tts": true,
    "led": true,
    "mcp": true
  },
  "mcp_tools": ["self.light.set_rgb", "self.light.get_state", "self.display.show_text"]
}
```

### 2. OpenClaw 端 API（发送到设备）

#### 2.1 设备注册

在 OpenClaw 配置中注册设备的 HTTP 端点：

```json5
{
  channels: {
    xiaozhi: {
      enabled: true,
      protocol: "http",

      http: {
        devices: {
          "xiaozhi-001": {
            url: "http://192.168.1.100:8080", // 内网地址
            // 或使用公网地址（需要端口映射或 Tailscale）
            // url: "https://xiaozhi-001.your-domain.com",
            token: "device-secret-token-here",
            timeout_ms: 5000,
            retry: {
              max_attempts: 3,
              backoff_ms: 1000,
            },
          },
        },
      },
    },
  },
}
```

#### 2.2 发送通知（OpenClaw 调用）

```typescript
// OpenClaw Agent 工具调用
await xiaozhi.notify({
  device_id: "xiaozhi-001",
  message: "会议提醒：3点钟有会议",
  priority: "high",
  tts: true,
  led_effect: "pulse_blue",
});
```

内部实现：

```typescript
async function sendNotification(deviceId: string, notification: Notification) {
  const device = config.channels.xiaozhi.http.devices[deviceId];

  const response = await fetch(`${device.url}/api/notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${device.token}`,
    },
    body: JSON.stringify(notification),
    signal: AbortSignal.timeout(device.timeout_ms),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}
```

## 网络配置方案

### 方案 1: 内网直连（最简单）

**适用场景**: OpenClaw 和设备在同一局域网

**配置**:

```json5
{
  url: "http://192.168.1.100:8080",
}
```

**优点**:

- 无需额外配置
- 低延迟
- 安全

**缺点**:

- 仅限局域网

### 方案 2: 端口映射（公网访问）

**适用场景**: 需要从外网访问设备

**配置步骤**:

1. 路由器配置端口映射: `外网端口 8080 → 设备 IP:8080`
2. 使用动态 DNS（如 DuckDNS）
3. OpenClaw 配置:

```json5
{
  url: "http://your-ddns-domain.duckdns.org:8080",
}
```

**优点**:

- 支持公网访问
- 成本低

**缺点**:

- 安全风险（建议使用 HTTPS + 强 token）
- 需要路由器支持

### 方案 3: Tailscale VPN（推荐）

**适用场景**: 安全的远程访问

**配置步骤**:

1. 在 OpenClaw 服务器和设备上安装 Tailscale
2. 设备获得 Tailscale IP（如 `100.64.1.2`）
3. OpenClaw 配置:

```json5
{
  url: "http://100.64.1.2:8080",
}
```

**优点**:

- 安全（端到端加密）
- 无需端口映射
- 支持跨网络

**缺点**:

- 需要安装 Tailscale

### 方案 4: 反向代理（企业级）

**适用场景**: 多设备管理，需要统一入口

**架构**:

```
OpenClaw → Nginx/Caddy → 多个 xiaozhi 设备
```

**Nginx 配置示例**:

```nginx
upstream xiaozhi_001 {
    server 192.168.1.100:8080;
}

upstream xiaozhi_002 {
    server 192.168.1.101:8080;
}

server {
    listen 443 ssl;
    server_name xiaozhi.your-domain.com;

    location /devices/xiaozhi-001/ {
        proxy_pass http://xiaozhi_001/;
        proxy_set_header Authorization $http_authorization;
    }

    location /devices/xiaozhi-002/ {
        proxy_pass http://xiaozhi_002/;
        proxy_set_header Authorization $http_authorization;
    }
}
```

**OpenClaw 配置**:

```json5
{
  devices: {
    "xiaozhi-001": {
      url: "https://xiaozhi.your-domain.com/devices/xiaozhi-001",
    },
    "xiaozhi-002": {
      url: "https://xiaozhi.your-domain.com/devices/xiaozhi-002",
    },
  },
}
```

## 安全考虑

### 1. 认证

**设备端验证**:

```c
// ESP32 代码示例
bool verify_token(const char* token) {
    const char* expected_token = get_device_token();
    return strcmp(token, expected_token) == 0;
}

// HTTP 请求处理
if (!verify_token(request->auth_token)) {
    send_response(401, "Unauthorized");
    return;
}
```

### 2. HTTPS 支持

**使用自签名证书**:

```bash
# 生成证书
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes

# ESP32 配置
# 将证书烧录到设备
```

**使用 Let's Encrypt**（通过反向代理）:

```bash
certbot --nginx -d xiaozhi.your-domain.com
```

### 3. 速率限制

**设备端限流**:

```c
#define MAX_REQUESTS_PER_MINUTE 60

static int request_count = 0;
static time_t last_reset = 0;

bool check_rate_limit() {
    time_t now = time(NULL);
    if (now - last_reset > 60) {
        request_count = 0;
        last_reset = now;
    }

    if (request_count >= MAX_REQUESTS_PER_MINUTE) {
        return false;  // 超过限制
    }

    request_count++;
    return true;
}
```

## 错误处理与重试

### OpenClaw 端重试逻辑

```typescript
async function sendWithRetry(
  deviceId: string,
  notification: Notification,
  maxAttempts: number = 3,
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendNotification(deviceId, notification);
      return; // 成功
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxAttempts) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await sleep(backoffMs);
      }
    }
  }

  throw new Error(
    `Failed to send notification after ${maxAttempts} attempts: ${lastError?.message}`,
  );
}
```

### 设备离线处理

```typescript
// 检查设备在线状态
async function checkDeviceOnline(deviceId: string): Promise<boolean> {
  try {
    const response = await fetch(`${device.url}/api/status`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

// 发送前检查
if (!(await checkDeviceOnline(deviceId))) {
  // 设备离线，加入队列稍后重试
  await queueNotification(deviceId, notification);
  return;
}
```

## 使用示例

### 场景 1: 定时提醒推送

```typescript
// OpenClaw Cron 任务配置
{
  name: "早晨提醒",
  schedule: {
    kind: "cron",
    expr: "0 8 * * *",  // 每天早上8点
    tz: "Asia/Shanghai"
  },
  sessionTarget: "isolated",
  wakeMode: "now",
  payload: {
    kind: "agentTurn",
    message: "发送早安提醒到 xiaozhi-001",
    deliver: true,
    channel: "xiaozhi",
    to: "xiaozhi-001"
  }
}
```

### 场景 2: Agent 主动推送

```typescript
// Agent 工具调用
const result = await use_tool("xiaozhi_notify", {
  device_id: "xiaozhi-001",
  message: "您的快递已到达小区门口",
  priority: "normal",
  tts: true,
  led_effect: "pulse_green",
});
```

### 场景 3: 第三方集成

```bash
# 通过 OpenClaw Gateway API 发送
curl -X POST http://localhost:18789/api/xiaozhi/notify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-gateway-token" \
  -d '{
    "device_id": "xiaozhi-001",
    "message": "来自第三方系统的通知",
    "priority": "high"
  }'
```

## 性能优化

### 1. 连接池

```typescript
import { Agent } from "http";

const httpAgent = new Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 5000,
});

// 使用连接池
fetch(url, { agent: httpAgent });
```

### 2. 批量推送

```typescript
// 同时推送到多个设备
async function notifyMultipleDevices(deviceIds: string[], notification: Notification) {
  const promises = deviceIds.map((id) => sendNotification(id, notification));

  const results = await Promise.allSettled(promises);

  return results.map((result, index) => ({
    device_id: deviceIds[index],
    success: result.status === "fulfilled",
    error: result.status === "rejected" ? result.reason : null,
  }));
}
```

### 3. 消息队列

```typescript
// 使用队列处理离线设备
class NotificationQueue {
  private queue: Map<string, Notification[]> = new Map();

  async enqueue(deviceId: string, notification: Notification) {
    if (!this.queue.has(deviceId)) {
      this.queue.set(deviceId, []);
    }
    this.queue.get(deviceId)!.push(notification);
  }

  async processQueue(deviceId: string) {
    const notifications = this.queue.get(deviceId) || [];
    this.queue.delete(deviceId);

    for (const notification of notifications) {
      try {
        await sendNotification(deviceId, notification);
      } catch (error) {
        // 重新入队或丢弃
      }
    }
  }
}
```

## 监控与日志

### 设备端日志

```c
// ESP32 日志
ESP_LOGI(TAG, "Received notification: id=%s, priority=%s",
         notif_id, priority);
ESP_LOGI(TAG, "TTS playback started: duration=%d ms", duration_ms);
ESP_LOGI(TAG, "HTTP request from %s: %s %s",
         client_ip, method, uri);
```

### OpenClaw 端监控

```typescript
// 记录推送统计
const stats = {
  total_sent: 0,
  success: 0,
  failed: 0,
  avg_latency_ms: 0,
};

// 每次推送后更新
function recordPushResult(success: boolean, latencyMs: number) {
  stats.total_sent++;
  if (success) {
    stats.success++;
  } else {
    stats.failed++;
  }
  stats.avg_latency_ms =
    (stats.avg_latency_ms * (stats.total_sent - 1) + latencyMs) / stats.total_sent;
}
```

## 总结

HTTP 推送协议提供了一种简单、灵活的方式将 OpenClaw 与 xiaozhi-esp32 设备集成：

✅ 无需保持长连接
✅ 支持公网访问
✅ 易于调试和测试
✅ 可与现有系统集成
✅ 支持多种网络配置方案

适用于定时提醒、远程通知等场景，与 WebSocket/MQTT 协议互补。
