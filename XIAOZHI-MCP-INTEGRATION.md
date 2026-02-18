# xiaozhi-esp32 与 OpenClaw MCP 深度对接方案

## 概述

MCP (Model Context Protocol) 是一个标准化的协议，用于 AI 模型与外部工具、设备的交互。本方案实现 xiaozhi-esp32 设备作为 MCP Server，OpenClaw Agent 作为 MCP Client，实现深度的物联网控制和状态查询。

## MCP 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw Agent                            │
│  ┌────────────────────────────────────────────────────┐     │
│  │              MCP Client                            │     │
│  │  - Tool Discovery                                  │     │
│  │  - Tool Invocation                                 │     │
│  │  - Resource Access                                 │     │
│  │  - Prompt Templates                                │     │
│  └────────────────────────────────────────────────────┘     │
└────────────────────────────┬────────────────────────────────┘
                             │
                    JSON-RPC 2.0 over
                    WebSocket/MQTT/HTTP
                             │
┌────────────────────────────┴────────────────────────────────┐
│                   xiaozhi-esp32 设备                         │
│  ┌────────────────────────────────────────────────────┐     │
│  │              MCP Server                            │     │
│  │  - tools/list      (列出可用工具)                  │     │
│  │  - tools/call      (执行工具)                      │     │
│  │  - resources/list  (列出资源)                      │     │
│  │  - resources/read  (读取资源)                      │     │
│  │  - prompts/list    (列出提示模板)                  │     │
│  └────────────────────────────────────────────────────┘     │
│  ┌────────────────────────────────────────────────────┐     │
│  │              Device Capabilities                   │     │
│  │  - LED 控制                                         │     │
│  │  - 显示屏控制                                       │     │
│  │  - 音频播放                                         │     │
│  │  - 传感器读取                                       │     │
│  │  - 系统信息                                         │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## MCP 协议实现

### 1. 工具发现 (tools/list)

#### 请求（OpenClaw → 设备）

```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
```

#### 响应（设备 → OpenClaw）

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "self.light.set_rgb",
        "description": "设置 LED 灯的 RGB 颜色",
        "inputSchema": {
          "type": "object",
          "properties": {
            "r": {
              "type": "integer",
              "minimum": 0,
              "maximum": 255,
              "description": "红色分量 (0-255)"
            },
            "g": {
              "type": "integer",
              "minimum": 0,
              "maximum": 255,
              "description": "绿色分量 (0-255)"
            },
            "b": {
              "type": "integer",
              "minimum": 0,
              "maximum": 255,
              "description": "蓝色分量 (0-255)"
            },
            "brightness": {
              "type": "integer",
              "minimum": 0,
              "maximum": 100,
              "description": "亮度 (0-100)，可选",
              "default": 100
            }
          },
          "required": ["r", "g", "b"]
        }
      },
      {
        "name": "self.light.set_effect",
        "description": "设置 LED 灯效",
        "inputSchema": {
          "type": "object",
          "properties": {
            "effect": {
              "type": "string",
              "enum": ["off", "solid", "pulse", "breathe", "rainbow", "flash"],
              "description": "灯效类型"
            },
            "speed": {
              "type": "integer",
              "minimum": 1,
              "maximum": 10,
              "description": "速度 (1-10)，可选",
              "default": 5
            }
          },
          "required": ["effect"]
        }
      },
      {
        "name": "self.display.show_text",
        "description": "在显示屏上显示文本",
        "inputSchema": {
          "type": "object",
          "properties": {
            "text": {
              "type": "string",
              "maxLength": 100,
              "description": "要显示的文本"
            },
            "duration_ms": {
              "type": "integer",
              "minimum": 0,
              "description": "显示时长（毫秒），0 表示持续显示",
              "default": 0
            },
            "font_size": {
              "type": "integer",
              "enum": [12, 16, 24, 32],
              "description": "字体大小",
              "default": 16
            }
          },
          "required": ["text"]
        }
      },
      {
        "name": "self.audio.play_tone",
        "description": "播放提示音",
        "inputSchema": {
          "type": "object",
          "properties": {
            "frequency": {
              "type": "integer",
              "minimum": 100,
              "maximum": 10000,
              "description": "频率 (Hz)"
            },
            "duration_ms": {
              "type": "integer",
              "minimum": 10,
              "maximum": 5000,
              "description": "持续时间（毫秒）"
            },
            "volume": {
              "type": "integer",
              "minimum": 0,
              "maximum": 100,
              "description": "音量 (0-100)",
              "default": 50
            }
          },
          "required": ["frequency", "duration_ms"]
        }
      },
      {
        "name": "self.sensor.read_temperature",
        "description": "读取温度传感器数据",
        "inputSchema": {
          "type": "object",
          "properties": {}
        }
      },
      {
        "name": "self.system.get_info",
        "description": "获取系统信息",
        "inputSchema": {
          "type": "object",
          "properties": {}
        }
      }
    ]
  }
}
```

### 2. 工具调用 (tools/call)

#### 示例 1: 设置 LED 颜色

**请求**:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "self.light.set_rgb",
    "arguments": {
      "r": 255,
      "g": 0,
      "b": 0,
      "brightness": 80
    }
  },
  "id": 2
}
```

**响应**:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "LED 已设置为红色，亮度 80%"
      }
    ],
    "isError": false
  }
}
```

#### 示例 2: 显示文本

**请求**:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "self.display.show_text",
    "arguments": {
      "text": "会议提醒",
      "duration_ms": 5000,
      "font_size": 24
    }
  },
  "id": 3
}
```

**响应**:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "文本已显示在屏幕上"
      }
    ],
    "isError": false
  }
}
```

#### 示例 3: 读取传感器

**请求**:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "self.sensor.read_temperature",
    "arguments": {}
  },
  "id": 4
}
```

**响应**:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "当前温度: 23.5°C, 湿度: 65%"
      }
    ],
    "isError": false
  }
}
```

### 3. 资源访问 (resources/list & resources/read)

#### 列出资源

**请求**:

```json
{
  "jsonrpc": "2.0",
  "method": "resources/list",
  "id": 5
}
```

**响应**:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "resources": [
      {
        "uri": "device://xiaozhi-001/status",
        "name": "设备状态",
        "description": "当前设备的运行状态",
        "mimeType": "application/json"
      },
      {
        "uri": "device://xiaozhi-001/logs",
        "name": "设备日志",
        "description": "最近的系统日志",
        "mimeType": "text/plain"
      },
      {
        "uri": "device://xiaozhi-001/config",
        "name": "设备配置",
        "description": "当前设备配置",
        "mimeType": "application/json"
      }
    ]
  }
}
```

#### 读取资源

**请求**:

```json
{
  "jsonrpc": "2.0",
  "method": "resources/read",
  "params": {
    "uri": "device://xiaozhi-001/status"
  },
  "id": 6
}
```

**响应**:

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "result": {
    "contents": [
      {
        "uri": "device://xiaozhi-001/status",
        "mimeType": "application/json",
        "text": "{\"state\":\"idle\",\"battery\":85,\"wifi_rssi\":-45,\"uptime\":86400,\"temperature\":23.5}"
      }
    ]
  }
}
```

### 4. 提示模板 (prompts/list & prompts/get)

#### 列出提示模板

**请求**:

```json
{
  "jsonrpc": "2.0",
  "method": "prompts/list",
  "id": 7
}
```

**响应**:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "prompts": [
      {
        "name": "device_control",
        "description": "控制 xiaozhi 设备的提示模板",
        "arguments": [
          {
            "name": "action",
            "description": "要执行的动作",
            "required": true
          }
        ]
      }
    ]
  }
}
```

## OpenClaw Agent 集成

### 1. 自动工具发现

OpenClaw Agent 启动时自动发现设备的 MCP 工具：

```typescript
// 在 Agent 初始化时
async function discoverDeviceTools(deviceId: string) {
  const response = await sendMcpRequest(deviceId, {
    jsonrpc: "2.0",
    method: "tools/list",
    id: generateId(),
  });

  const tools = response.result.tools;

  // 将设备工具注册到 Agent
  for (const tool of tools) {
    registerAgentTool({
      name: `xiaozhi_${deviceId}_${tool.name.replace(/\./g, "_")}`,
      description: `[设备 ${deviceId}] ${tool.description}`,
      input_schema: tool.inputSchema,
      handler: async (args) => {
        return await callDeviceTool(deviceId, tool.name, args);
      },
    });
  }
}
```

### 2. Agent 使用示例

#### 场景 1: 用户语音控制

**用户**: "把灯调成蓝色"

**Agent 处理**:

```typescript
// Agent 自动选择合适的工具
await use_tool("xiaozhi_xiaozhi-001_self_light_set_rgb", {
  r: 0,
  g: 0,
  b: 255,
  brightness: 100,
});
```

**设备响应**: LED 灯变为蓝色

#### 场景 2: 定时任务触发

**Cron 任务**: 每天早上 7 点

**Agent 执行**:

```typescript
// 显示早安消息
await use_tool("xiaozhi_xiaozhi-001_self_display_show_text", {
  text: "早安！今天是美好的一天",
  duration_ms: 10000,
  font_size: 24,
});

// 设置温馨的灯光
await use_tool("xiaozhi_xiaozhi-001_self_light_set_rgb", {
  r: 255,
  g: 200,
  b: 100,
  brightness: 60,
});

// 播放提示音
await use_tool("xiaozhi_xiaozhi-001_self_audio_play_tone", {
  frequency: 800,
  duration_ms: 500,
  volume: 30,
});
```

#### 场景 3: 环境监测

**用户**: "现在温度多少？"

**Agent 处理**:

```typescript
const result = await use_tool("xiaozhi_xiaozhi-001_self_sensor_read_temperature", {});

// result.content[0].text = "当前温度: 23.5°C, 湿度: 65%"
```

**Agent 回复**: "当前温度是 23.5 度，湿度 65%"

### 3. 复杂场景编排

#### 场景: 会议提醒

```typescript
// Cron 任务触发
async function meetingReminder() {
  // 1. 显示提醒文本
  await use_tool("xiaozhi_xiaozhi-001_self_display_show_text", {
    text: "会议提醒：3点开会",
    duration_ms: 0, // 持续显示
    font_size: 24,
  });

  // 2. 设置提醒灯效
  await use_tool("xiaozhi_xiaozhi-001_self_light_set_effect", {
    effect: "pulse",
    speed: 5,
  });

  // 3. 播放提示音
  await use_tool("xiaozhi_xiaozhi-001_self_audio_play_tone", {
    frequency: 1000,
    duration_ms: 200,
    volume: 50,
  });

  // 4. 等待 200ms
  await sleep(200);

  // 5. 再次播放提示音
  await use_tool("xiaozhi_xiaozhi-001_self_audio_play_tone", {
    frequency: 1200,
    duration_ms: 200,
    volume: 50,
  });

  // 6. 通过 TTS 语音提醒
  await use_tool("xiaozhi_notify", {
    device_id: "xiaozhi-001",
    message: "会议提醒：3点钟有会议，请准备参加",
    tts: true,
  });
}
```

## ESP32 端实现要点

### 1. MCP Server 基础结构

```c
// MCP 消息处理
void handle_mcp_message(const char* payload) {
    cJSON* root = cJSON_Parse(payload);
    if (!root) {
        send_mcp_error(-32700, "Parse error");
        return;
    }

    cJSON* method = cJSON_GetObjectItem(root, "method");
    cJSON* id = cJSON_GetObjectItem(root, "id");

    if (!cJSON_IsString(method)) {
        send_mcp_error(-32600, "Invalid Request");
        cJSON_Delete(root);
        return;
    }

    const char* method_name = method->valuestring;

    if (strcmp(method_name, "tools/list") == 0) {
        handle_tools_list(id);
    } else if (strcmp(method_name, "tools/call") == 0) {
        handle_tools_call(root, id);
    } else if (strcmp(method_name, "resources/list") == 0) {
        handle_resources_list(id);
    } else if (strcmp(method_name, "resources/read") == 0) {
        handle_resources_read(root, id);
    } else {
        send_mcp_error(-32601, "Method not found");
    }

    cJSON_Delete(root);
}
```

### 2. 工具注册

```c
typedef struct {
    const char* name;
    const char* description;
    const char* input_schema_json;
    bool (*handler)(const cJSON* args, char* result, size_t result_size);
} MCP_Tool;

// 工具列表
static const MCP_Tool mcp_tools[] = {
    {
        .name = "self.light.set_rgb",
        .description = "设置 LED 灯的 RGB 颜色",
        .input_schema_json = "{\"type\":\"object\",\"properties\":{...}}",
        .handler = tool_light_set_rgb
    },
    {
        .name = "self.display.show_text",
        .description = "在显示屏上显示文本",
        .input_schema_json = "{\"type\":\"object\",\"properties\":{...}}",
        .handler = tool_display_show_text
    },
    // ... 更多工具
};

// 工具实现示例
bool tool_light_set_rgb(const cJSON* args, char* result, size_t result_size) {
    int r = cJSON_GetObjectItem(args, "r")->valueint;
    int g = cJSON_GetObjectItem(args, "g")->valueint;
    int b = cJSON_GetObjectItem(args, "b")->valueint;
    int brightness = 100;

    cJSON* brightness_item = cJSON_GetObjectItem(args, "brightness");
    if (brightness_item) {
        brightness = brightness_item->valueint;
    }

    // 实际控制 LED
    led_set_rgb(r, g, b, brightness);

    snprintf(result, result_size,
             "LED 已设置为 RGB(%d,%d,%d)，亮度 %d%%",
             r, g, b, brightness);

    return true;
}
```

### 3. 工具列表响应

```c
void handle_tools_list(const cJSON* id) {
    cJSON* response = cJSON_CreateObject();
    cJSON_AddStringToObject(response, "jsonrpc", "2.0");
    cJSON_AddItemToObject(response, "id", cJSON_Duplicate(id, true));

    cJSON* result = cJSON_CreateObject();
    cJSON* tools_array = cJSON_CreateArray();

    // 遍历所有工具
    for (size_t i = 0; i < sizeof(mcp_tools) / sizeof(mcp_tools[0]); i++) {
        cJSON* tool = cJSON_CreateObject();
        cJSON_AddStringToObject(tool, "name", mcp_tools[i].name);
        cJSON_AddStringToObject(tool, "description", mcp_tools[i].description);

        // 解析并添加 input schema
        cJSON* schema = cJSON_Parse(mcp_tools[i].input_schema_json);
        cJSON_AddItemToObject(tool, "inputSchema", schema);

        cJSON_AddItemToArray(tools_array, tool);
    }

    cJSON_AddItemToObject(result, "tools", tools_array);
    cJSON_AddItemToObject(response, "result", result);

    // 发送响应
    char* response_str = cJSON_PrintUnformatted(response);
    send_mcp_response(response_str);
    free(response_str);
    cJSON_Delete(response);
}
```

## 配置示例

### OpenClaw 配置

```json5
{
  channels: {
    xiaozhi: {
      enabled: true,
      protocol: "websocket",

      mcp: {
        enabled: true,
        auto_discover: true, // 自动发现设备工具
        tool_prefix: "xiaozhi", // 工具名称前缀
        cache_tools: true, // 缓存工具列表
        cache_ttl_seconds: 3600,
      },

      devices: {
        "xiaozhi-001": {
          name: "客厅小智",
          enabled: true,
          mcp_enabled: true,
        },
      },
    },
  },
}
```

### ESP32 配置

```c
// 启用 MCP 支持
#define CONFIG_MCP_ENABLED 1

// MCP 工具配置
#define MCP_MAX_TOOLS 20
#define MCP_MAX_RESOURCES 10
```

## 性能优化

### 1. 工具缓存

```typescript
// OpenClaw 端缓存设备工具
const toolCache = new Map<string, Tool[]>();

async function getDeviceTools(deviceId: string): Promise<Tool[]> {
  if (toolCache.has(deviceId)) {
    return toolCache.get(deviceId)!;
  }

  const tools = await discoverDeviceTools(deviceId);
  toolCache.set(deviceId, tools);

  // 设置过期时间
  setTimeout(() => {
    toolCache.delete(deviceId);
  }, 3600 * 1000); // 1 小时

  return tools;
}
```

### 2. 批量调用

```typescript
// 批量执行多个工具
async function batchCallTools(deviceId: string, calls: Array<{ tool: string; args: any }>) {
  const promises = calls.map((call) => callDeviceTool(deviceId, call.tool, call.args));

  return await Promise.all(promises);
}
```

## 错误处理

### MCP 标准错误码

```typescript
const MCP_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
};

// 错误响应示例
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": "参数 'r' 必须在 0-255 之间"
  }
}
```

## 总结

MCP 深度对接实现了：

✅ 标准化的设备控制协议
✅ 自动工具发现和注册
✅ 类型安全的参数验证
✅ 灵活的资源访问
✅ 可扩展的工具系统
✅ 与 OpenClaw Agent 无缝集成

通过 MCP 协议，OpenClaw Agent 可以像使用内置工具一样控制 xiaozhi 设备，实现真正的智能家居控制。
