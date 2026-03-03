---
title: "工具循环检测"
description: "配置可选护栏以防止重复或停滞的工具调用循环"
summary: "如何启用和调优检测重复工具调用循环的护栏"
read_when:
  - 用户报告智能体卡在重复工具调用中
  - 您需要调优重复调用保护
  - 您正在编辑智能体工具/运行时策略
---

# 工具循环检测

OpenClaw 可以防止智能体陷入重复的工具调用模式。该护栏**默认禁用**。

仅在需要时启用，因为严格设置可能会阻止合法的重复调用。

## 存在原因

- 检测没有进展的重复序列。
- 检测高频无结果循环（相同工具、相同输入、重复错误）。
- 检测已知轮询工具的特定重复调用模式。

## 配置块

全局默认值：

```json5
{
  tools: {
    loopDetection: {
      enabled: false,
      historySize: 20,
      detectorCooldownMs: 12000,
      repeatThreshold: 3,
      criticalThreshold: 6,
      detectors: {
        repeatedFailure: true,
        knownPollLoop: true,
        repeatingNoProgress: true,
      },
    },
  },
}
```

每智能体覆盖（可选）：

```json5
{
  agents: {
    list: [
      {
        id: "safe-runner",
        tools: {
          loopDetection: {
            enabled: true,
            repeatThreshold: 2,
            criticalThreshold: 5,
          },
        },
      },
    ],
  },
}
```

### 字段说明

- `enabled`：主开关。`false` 表示不执行循环检测。
- `historySize`：保留用于分析的最近工具调用数量。
- `detectorCooldownMs`：无进展检测器使用的时间窗口。
- `repeatThreshold`：开始警告/阻止前的最小重复次数。
- `criticalThreshold`：可触发更严格处理的更高阈值。
- `detectors.repeatedFailure`：检测在同一调用路径上的重复失败尝试。
- `detectors.knownPollLoop`：检测已知的类轮询循环。
- `detectors.repeatingNoProgress`：检测无状态变化的高频重复调用。

## 推荐设置

- 从 `enabled: true` 开始，保持默认值不变。
- 如果出现误报：
  - 提高 `repeatThreshold` 和/或 `criticalThreshold`
  - 仅禁用导致问题的检测器
  - 减小 `historySize` 以降低历史上下文的严格程度

## 日志和预期行为

检测到循环时，OpenClaw 会报告循环事件，并根据严重程度阻止或抑制下一个工具调用周期。这可以保护用户免受 token 消耗失控和锁定，同时保留正常的工具访问。

- 优先使用警告和临时抑制。
- 仅在累积重复证据时才升级处理。

## 备注

- `tools.loopDetection` 与智能体级别的覆盖合并。
- 每智能体配置完全覆盖或扩展全局值。
- 如果没有配置，护栏保持关闭。
