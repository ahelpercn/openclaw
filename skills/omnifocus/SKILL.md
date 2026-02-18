---
name: omnifocus
description: Manage OmniFocus tasks via of-cli (read inbox/today/projects/search; add tasks via URL scheme). Works with OmniFocus standard and Pro on macOS.
homepage: https://www.omnigroup.com/omnifocus
metadata:
  {
    "openclaw":
      {
        "emoji": "✅",
        "os": ["darwin"],
        "requires": { "bins": ["of-cli"] },
        "install":
          [
            {
              "id": "manual",
              "kind": "manual",
              "label": "Copy of-cli to ~/bin and chmod +x",
              "instructions": "cp ~/bin/of-cli /usr/local/bin/of-cli && chmod +x /usr/local/bin/of-cli",
            },
          ],
      },
  }
---

# OmniFocus CLI (of-cli)

Use `of-cli` to read OmniFocus tasks and add new ones via URL scheme. Works with **Standard and Pro** editions.

> ⚠️ `of-cli` reads the `.ofocus` database directly — **do not run while OmniFocus is syncing**. For writes, URL scheme is used (always safe).

## When to Use

✅ **USE this skill when:**

- User mentions "OmniFocus", "OF", "任务", "今日任务"
- User wants to add a task to OmniFocus
- User wants to review today's due tasks or inbox
- User wants to search their task list
- Generating daily briefings that include task status

❌ **DON'T use this skill when:**

- User wants reminders on iPhone → use apple-reminders
- User wants calendar events → use Apple Calendar / 飞书日历
- Scheduling bot alerts → use cron tool

## Setup

```bash
# 确保 ~/bin 在 PATH 中
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# 验证安装
of-cli projects
```

## Common Commands

### 读取任务

```bash
of-cli today              # 今日到期任务
of-cli inbox              # 收件箱未完成任务
of-cli projects           # 活跃项目列表
of-cli search "关键词"    # 搜索任务（名称匹配）
```

### JSON 输出（适合脚本处理）

```bash
of-cli today --json
of-cli inbox --json
of-cli projects --json
of-cli search "ESP32" --json
```

### 显示任务 ID

```bash
of-cli inbox --id         # 显示任务内部ID（用于搜索定位）
```

### 添加任务（URL scheme）

```bash
# 基本添加
of-cli add "任务标题"

# 带备注和截止日期
of-cli add "完成ESP32驱动" --note "参考datasheet第3章" --due 2026-02-25

# 指定项目
of-cli add "修复BLE连接问题" --project "MyDazy P30"

# 带标签
of-cli add "Code Review" --tags "工作,紧急"

# 预览（不实际执行）
of-cli add "测试任务" --dry-run
```

## 日报生成示例

```bash
echo "=== 📅 今日任务 ===" && of-cli today
echo "=== 📥 收件箱 ===" && of-cli inbox
```

## 输出格式说明

- `⬜` = 未完成
- `✅` = 已完成
- `| 截止: YYYY-MM-DD` = 截止日期
- `| ID: xxx` = 内部ID（仅 --id 模式）

## 常见场景

**用户说：** "帮我把今天要做的事列出来"

```bash
of-cli today
```

**用户说：** "给OmniFocus添加一个任务：明天review代码"

```bash
of-cli add "Review 代码" --due $(date -v+1d +%Y-%m-%d)
```

**用户说：** "我的inbox里有什么"

```bash
of-cli inbox
```

**用户说：** "搜索ESP32相关任务"

```bash
of-cli search "ESP32"
```

## 限制说明

- **读取**：解析本地 `.ofocus` 数据库（zip格式的XML事务日志）
- **写入**：仅支持 URL scheme（`omnifocus:///add`），无法通过脚本修改/删除现有任务
- **完成任务**：需要打开 OmniFocus 手动操作（标准版限制）
- **Pro版用户**：可额外使用 OmniFocus JavaScript Automation，功能更强
