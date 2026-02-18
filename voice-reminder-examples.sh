#!/bin/bash
# OpenClaw 语音提醒实战示例

# ============================================================
# 场景 1: 通过 CLI 创建语音提醒
# ============================================================

# 创建一次性提醒 (20分钟后)
openclaw cron add \
  --name "会议提醒" \
  --at "20m" \
  --session isolated \
  --message "提醒: 20分钟前你让我提醒你参加下午3点的会议" \
  --deliver \
  --channel whatsapp \
  --to "+86138xxxxxxxx"

# 创建每日早晨提醒 (带语音播报)
openclaw cron add \
  --name "每日早安" \
  --cron "0 7 * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --message "早上好! 今天的天气和日程安排是什么?" \
  --deliver \
  --channel telegram \
  --to "your_telegram_id"

# 创建每周工作总结提醒
openclaw cron add \
  --name "周五工作总结" \
  --cron "0 17 * * 5" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --message "本周工作总结: 请列出本周完成的主要任务和下周计划" \
  --model "opus" \
  --thinking high \
  --deliver \
  --channel whatsapp \
  --to "+86138xxxxxxxx"

# ============================================================
# 场景 2: 通过语音消息创建提醒
# ============================================================

# 用户发送语音消息到 WhatsApp:
# "嘿 OpenClaw, 提醒我明天下午2点给客户打电话"

# 系统自动处理流程:
# 1. 接收 WhatsApp 语音消息
# 2. 自动转录 (Whisper/Deepgram)
# 3. Agent 解析意图 → 调用 cron.add 工具
# 4. 创建定时任务
# 5. 回复确认: "已设置明天下午2点的提醒"

# ============================================================
# 场景 3: Talk Mode 持续对话
# ============================================================

# 启动 Talk Mode (macOS/iOS/Android)
openclaw talk

# 对话示例:
# 用户: "提醒我30分钟后休息一下"
# 助手: (语音) "好的,我会在30分钟后提醒你休息"
# [30分钟后]
# 助手: (自动语音播报) "该休息了,已经工作30分钟了"

# ============================================================
# 场景 4: 查看和管理提醒
# ============================================================

# 列出所有提醒
openclaw cron list

# 查看特定提醒的执行历史
openclaw cron runs --id <job-id> --limit 10

# 立即执行提醒 (测试)
openclaw cron run <job-id> --force

# 编辑提醒
openclaw cron edit <job-id> \
  --message "更新后的提醒内容" \
  --cron "0 8 * * *"

# 删除提醒
openclaw cron remove <job-id>

# ============================================================
# 场景 5: 多渠道提醒投递
# ============================================================

# 同时发送到 WhatsApp + Telegram
openclaw cron add \
  --name "重要会议提醒" \
  --at "2026-02-05T14:00:00+08:00" \
  --session isolated \
  --message "重要提醒: 1小时后有董事会会议" \
  --deliver \
  --channel whatsapp \
  --to "+86138xxxxxxxx"

# 注: 如需多渠道,可创建多个 cron 任务指向不同渠道

# ============================================================
# 场景 6: 智能提醒 (带上下文)
# ============================================================

# 创建智能提醒 (Agent 会查询实时信息)
openclaw cron add \
  --name "出门前天气提醒" \
  --cron "0 7 * * 1-5" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --message "查询今天北京的天气,并建议是否需要带伞" \
  --model "opus" \
  --deliver \
  --channel whatsapp \
  --to "+86138xxxxxxxx"

# ============================================================
# 场景 7: 语音消息自动回复
# ============================================================

# 配置自动回复规则 (在 openclaw.json 中)
# 当收到语音消息时:
# 1. 自动转录
# 2. 如果包含"提醒"关键词 → 创建 cron 任务
# 3. 语音回复确认

# ============================================================
# 高级: 通过 Gateway API 创建提醒
# ============================================================

# 使用 WebSocket API (适合自定义集成)
cat <<'EOF' | openclaw gateway rpc
{
  "method": "cron.add",
  "params": {
    "name": "API创建的提醒",
    "schedule": {
      "kind": "at",
      "atMs": 1738742400000
    },
    "sessionTarget": "isolated",
    "wakeMode": "now",
    "payload": {
      "kind": "agentTurn",
      "message": "这是通过API创建的提醒",
      "deliver": true,
      "channel": "whatsapp",
      "to": "+86138xxxxxxxx"
    },
    "deleteAfterRun": true
  }
}
EOF