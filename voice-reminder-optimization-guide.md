# OpenClaw 语音提醒系统 - 成本优化与架构指南

## 📊 成本分析与优化策略

### 1. **成本构成分析** (按月估算)

#### 高成本场景 (全云端方案)

```
- Claude Opus 4.5 API:        $50-200/月  (主要对话)
- ElevenLabs TTS:             $20-80/月   (语音合成)
- OpenAI Whisper API:         $10-30/月   (音频转录)
- Deepgram (备用):            $5-20/月    (音频转录)
- 总计:                       $85-330/月
```

#### 中等成本场景 (混合方案) ⭐ **推荐**

```
- Claude Sonnet 4.5 API:      $20-80/月   (主要对话)
- ElevenLabs TTS:             $15-50/月   (仅提醒播报)
- 本地 Whisper:               $0          (本地转录)
- 总计:                       $35-130/月
```

#### 低成本场景 (本地优先)

```
- Claude Haiku API:           $5-20/月    (轻量对话)
- Edge TTS (微软):            $0          (免费语音合成)
- 本地 Whisper:               $0          (本地转录)
- 总计:                       $5-20/月
```

---

### 2. **成本优化策略**

#### 策略 1: 音频转录优化 💰 节省 60-80%

```json5
// ~/.openclaw/openclaw.json
{
  tools: {
    media: {
      audio: {
        enabled: true,
        maxBytes: 10485760, // 限制 10MB (降低处理成本)
        models: [
          // 优先使用本地 Whisper (免费)
          {
            type: "cli",
            command: "whisper",
            args: ["--model", "base", "--language", "zh", "{{MediaPath}}"],
            timeoutSeconds: 30,
          },
          // 备用: OpenAI (仅本地失败时)
          {
            provider: "openai",
            model: "gpt-4o-mini-transcribe", // 使用 mini 版本
          },
        ],
      },
    },
  },
}
```

**安装本地 Whisper:**

```bash
# macOS
brew install whisper-cpp
# 或使用 Python 版本
pip install openai-whisper

# Linux
sudo apt install whisper
```

#### 策略 2: TTS 成本优化 💰 节省 70-90%

```json5
{
  // 方案 A: 使用免费的 Edge TTS (微软)
  tts: {
    provider: "edge",
    voice: "zh-CN-XiaoxiaoNeural", // 中文女声
    rate: 1.0,
    auto: "tagged", // 仅标记的消息使用 TTS
  },

  // 方案 B: ElevenLabs 仅用于重要提醒
  talk: {
    provider: "elevenlabs",
    voiceId: "your_voice_id",
    apiKey: "your_key",
    // 限制使用场景
    enabledChannels: ["whatsapp"], // 仅 WhatsApp 使用
    maxDailyRequests: 50, // 每日限额
  },
}
```

#### 策略 3: 模型选择优化 💰 节省 50-70%

```json5
{
  agents: {
    defaults: {
      // 主会话使用高性能模型
      model: "anthropic/claude-sonnet-4-5",

      // Cron 提醒使用轻量模型
      cronModel: "anthropic/claude-haiku-4",

      // 简单任务使用 mini 模型
      fallbackModel: "openai/gpt-4o-mini",
    },
  },

  cron: {
    // 为不同类型的提醒设置不同模型
    defaultModel: "haiku", // 简单提醒用 Haiku
    complexModel: "sonnet", // 复杂任务用 Sonnet
  },
}
```

#### 策略 4: 智能缓存与批处理 💰 节省 30-50%

```json5
{
  agents: {
    defaults: {
      // 启用上下文缓存 (Anthropic)
      caching: {
        enabled: true,
        systemPromptCaching: true,
        toolDefinitionCaching: true,
      },

      // 会话压缩
      compaction: {
        enabled: true,
        maxTurns: 20, // 超过 20 轮自动压缩
        strategy: "summary",
      },
    },
  },

  cron: {
    // 批量处理提醒 (减少 API 调用)
    batchMode: true,
    batchWindowSeconds: 60, // 60秒内的提醒合并处理
  },
}
```

---

### 3. **架构优化建议**

#### 架构 A: 单机部署 (个人使用) ⭐ **最简单**

```
┌─────────────────────────────────────┐
│   macOS/Linux 主机                   │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  OpenClaw Gateway            │  │
│  │  - Voice Wake                │  │
│  │  - Talk Mode                 │  │
│  │  - Cron Scheduler            │  │
│  │  - 本地 Whisper              │  │
│  └──────────────────────────────┘  │
│           ↓                         │
│  ┌──────────────────────────────┐  │
│  │  消息渠道                     │  │
│  │  - WhatsApp (Baileys)        │  │
│  │  - Telegram Bot              │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
         ↓
    云端 API (按需)
    - Claude API
    - ElevenLabs (可选)
```

**优点:**

- 部署简单,维护成本低
- 本地转录,隐私性好
- 适合个人/小团队

**缺点:**

- 需要主机常驻运行
- 单点故障

#### 架构 B: 云端部署 (团队使用) ⭐ **推荐生产环境**

```
┌─────────────────────────────────────┐
│   云服务器 (VPS/Docker)              │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  OpenClaw Gateway            │  │
│  │  - Cron Scheduler            │  │
│  │  - 消息路由                   │  │
│  └──────────────────────────────┘  │
│           ↓                         │
│  ┌──────────────────────────────┐  │
│  │  Redis (可选)                 │  │
│  │  - 任务队列                   │  │
│  │  - 会话缓存                   │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│   客户端设备 (macOS/iOS/Android)     │
│  - Voice Wake                       │
│  - Talk Mode                        │
│  - 本地音频处理                      │
└─────────────────────────────────────┘
```

**优点:**

- 高可用性
- 支持多用户
- 易于扩展

**缺点:**

- 需要服务器成本
- 配置相对复杂

#### 架构 C: 混合部署 (最佳性价比) ⭐ **推荐**

```
┌─────────────────────────────────────┐
│   本地设备 (macOS/iOS/Android)       │
│  - Voice Wake (本地唤醒)             │
│  - Talk Mode (本地录音)              │
│  - 本地 Whisper (转录)               │
└─────────────────────────────────────┘
         ↓ (仅发送文本)
┌─────────────────────────────────────┐
│   轻量云服务器 (Raspberry Pi/VPS)    │
│  - OpenClaw Gateway                 │
│  - Cron Scheduler                   │
│  - 消息路由                          │
└─────────────────────────────────────┘
         ↓ (按需调用)
┌─────────────────────────────────────┐
│   云端 API                           │
│  - Claude API (对话)                │
│  - Edge TTS (免费语音)               │
└─────────────────────────────────────┘
```

**优点:**

- 成本最优 (本地处理 + 轻量服务器)
- 隐私性好 (音频不上传)
- 高可用性

---

### 4. **性能优化**

#### 优化 1: 音频处理加速

```json5
{
  tools: {
    media: {
      audio: {
        // 使用更快的模型
        models: [
          {
            type: "cli",
            command: "whisper",
            args: [
              "--model",
              "tiny", // tiny 模型最快 (准确率略低)
              "--language",
              "zh",
              "--fp16",
              "False", // 禁用 FP16 (CPU 更快)
              "{{MediaPath}}",
            ],
            timeoutSeconds: 15, // 缩短超时
          },
        ],

        // 预处理优化
        preprocessing: {
          resample: true,
          targetSampleRate: 16000, // 降采样加速
          removeNoise: false, // 禁用降噪 (加速)
        },
      },
    },
  },
}
```

#### 优化 2: Cron 调度优化

```json5
{
  cron: {
    enabled: true,
    maxConcurrentRuns: 3, // 允许并发执行

    // 智能调度
    scheduling: {
      // 避开高峰时段
      avoidPeakHours: true,
      peakHours: [9, 12, 18], // 9点、12点、18点

      // 合并相近提醒
      mergeWindow: 60, // 60秒内的提醒合并

      // 失败重试
      retryPolicy: {
        maxRetries: 3,
        backoffSeconds: [10, 30, 60],
      },
    },
  },
}
```

#### 优化 3: 网络优化

```json5
{
  gateway: {
    // 连接池优化
    http: {
      keepAlive: true,
      maxSockets: 50,
      timeout: 30000,
    },

    // API 请求优化
    api: {
      // 使用最近的区域
      region: "asia-pacific",

      // 启用压缩
      compression: true,

      // 请求缓存
      cache: {
        enabled: true,
        ttl: 300, // 5分钟
      },
    },
  },
}
```

---

### 5. **监控与告警**

#### 成本监控

```bash
# 查看 API 使用情况
openclaw status --usage

# 查看每日成本
openclaw usage report --daily

# 设置成本告警
openclaw config set alerts.dailyCostLimit 10  # $10/天
openclaw config set alerts.monthlyCostLimit 200  # $200/月
```

#### 性能监控

```json5
{
  monitoring: {
    enabled: true,

    // 性能指标
    metrics: {
      // 转录延迟
      transcriptionLatency: {
        threshold: 5000, // 5秒
        alert: true,
      },

      // TTS 延迟
      ttsLatency: {
        threshold: 3000, // 3秒
        alert: true,
      },

      // Cron 执行成功率
      cronSuccessRate: {
        threshold: 0.95, // 95%
        alert: true,
      },
    },

    // 日志
    logging: {
      level: "info",
      file: "~/.openclaw/logs/voice-reminders.log",
      rotation: "daily",
    },
  },
}
```

---

### 6. **最佳实践**

#### ✅ DO (推荐做法)

1. **使用本地 Whisper 进行音频转录** (节省 60-80% 成本)
2. **为简单提醒使用 Haiku 模型** (节省 70% 模型成本)
3. **启用上下文缓存** (Anthropic Prompt Caching)
4. **使用 Edge TTS 替代 ElevenLabs** (免费)
5. **设置每日/每月成本限额**
6. **定期清理旧的 Cron 任务**
7. **使用 `deleteAfterRun: true` 清理一次性提醒**
8. **批量处理相近时间的提醒**

#### ❌ DON'T (避免做法)

1. **不要对所有消息启用 TTS** (使用 `auto: "tagged"`)
2. **不要使用 Opus 处理简单提醒** (成本高 10 倍)
3. **不要保留无限历史记录** (启用压缩)
4. **不要在群组中启用自动转录** (成本爆炸)
5. **不要使用高质量音频格式** (16kHz 足够)
6. **不要忽略错误重试** (可能导致重复计费)

---

### 7. **故障排查**

#### 问题 1: 语音转录失败

```bash
# 检查 Whisper 安装
which whisper
whisper --version

# 测试转录
whisper test.mp3 --model base --language zh

# 查看日志
tail -f ~/.openclaw/logs/gateway.log | grep -i "transcription"
```

#### 问题 2: Cron 提醒未触发

```bash
# 检查 Cron 服务状态
openclaw cron list

# 查看任务详情
openclaw cron runs --id <job-id>

# 手动触发测试
openclaw cron run <job-id> --force

# 检查时区设置
date
timedatectl  # Linux
```

#### 问题 3: TTS 播放失败

```bash
# 检查 ElevenLabs API
curl -H "xi-api-key: YOUR_KEY" \
  https://api.elevenlabs.io/v1/voices

# 测试 Edge TTS
edge-tts --text "测试" --write-media test.mp3

# 查看音频设备
# macOS
system_profiler SPAudioDataType

# Linux
aplay -l
```

---

### 8. **成本估算工具**

```bash
# 创建成本估算脚本
cat > ~/.openclaw/scripts/cost-estimate.sh <<'EOF'
#!/bin/bash

# 获取本月使用量
USAGE=$(openclaw status --usage --json)

# 计算成本
CLAUDE_COST=$(echo "$USAGE" | jq '.claude.cost')
TTS_COST=$(echo "$USAGE" | jq '.elevenlabs.cost')
WHISPER_COST=$(echo "$USAGE" | jq '.openai.whisper.cost')

TOTAL=$(echo "$CLAUDE_COST + $TTS_COST + $WHISPER_COST" | bc)

echo "本月成本估算:"
echo "  Claude API:     \$$CLAUDE_COST"
echo "  ElevenLabs TTS: \$$TTS_COST"
echo "  Whisper API:    \$$WHISPER_COST"
echo "  总计:           \$$TOTAL"

# 预测月底成本
DAY=$(date +%d)
DAYS_IN_MONTH=$(date -d "$(date +%Y-%m-01) +1 month -1 day" +%d)
PROJECTED=$(echo "$TOTAL * $DAYS_IN_MONTH / $DAY" | bc)

echo ""
echo "预计月底总成本: \$$PROJECTED"
EOF

chmod +x ~/.openclaw/scripts/cost-estimate.sh
```

---

## 🎯 推荐配置 (中文用户)

```json5
{
  // 语音输入: 本地 Whisper (免费)
  tools: {
    media: {
      audio: {
        enabled: true,
        models: [
          {
            type: "cli",
            command: "whisper",
            args: ["--model", "base", "--language", "zh", "{{MediaPath}}"],
          },
        ],
      },
    },
  },

  // 语音输出: Edge TTS (免费)
  tts: {
    provider: "edge",
    voice: "zh-CN-XiaoxiaoNeural",
    auto: "tagged",
  },

  // 对话模型: Sonnet (性价比)
  agent: {
    model: "anthropic/claude-sonnet-4-5",
  },

  // 提醒模型: Haiku (低成本)
  cron: {
    defaultModel: "anthropic/claude-haiku-4",
  },

  // 消息渠道: 微信/企业微信 (通过 webhook)
  channels: {
    webhook: {
      enabled: true,
      endpoints: {
        wechat: "https://your-wechat-webhook",
      },
    },
  },
}
```

**预计月成本: $20-50** (主要是 Claude API)

---

## 📚 相关文档

- [Voice Wake 文档](docs/nodes/voicewake.md)
- [Talk Mode 文档](docs/nodes/talk.md)
- [Cron 任务文档](docs/automation/cron-jobs.md)
- [音频处理文档](docs/nodes/audio.md)
- [成本分析文档](docs/reference/api-usage-costs.md)
