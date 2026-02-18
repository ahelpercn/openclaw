/**
 * Task Scheduler
 * 定时任务调度器 - 实现24小时AI员工的自动化任务
 */

import { CronJob } from "cron";
import type { DeviceManager } from "./device-manager";
import type { BaiduVoiceGateway } from "./gateway";
import type { BaiduVoiceConfig } from "./index";
import { logger } from "./utils/logger";

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  cronExpression: string;
  enabled: boolean;
  deviceId?: string; // 指定设备，不指定则广播
  action: "voice" | "notification" | "function-call" | "custom";
  payload: any;
}

export class TaskScheduler {
  private config: BaiduVoiceConfig;
  private gateway: BaiduVoiceGateway;
  private deviceManager: DeviceManager;
  private jobs: Map<string, CronJob> = new Map();
  private tasks: ScheduledTask[] = [];

  constructor(config: BaiduVoiceConfig, gateway: BaiduVoiceGateway, deviceManager: DeviceManager) {
    this.config = config;
    this.gateway = gateway;
    this.deviceManager = deviceManager;
  }

  async start(): Promise<void> {
    logger.info("⏰ Starting Task Scheduler...");

    // 加载预定义任务
    this.loadPredefinedTasks();

    // 启动所有任务
    for (const task of this.tasks) {
      if (task.enabled) {
        this.scheduleTask(task);
      }
    }

    logger.info(`✅ Task Scheduler started with ${this.jobs.size} active tasks`);
  }

  async stop(): Promise<void> {
    logger.info("🛑 Stopping Task Scheduler...");

    for (const [id, job] of this.jobs) {
      job.stop();
      this.jobs.delete(id);
    }

    logger.info("✅ Task Scheduler stopped");
  }

  private loadPredefinedTasks(): void {
    // 早安问候 (每天 8:00)
    this.tasks.push({
      id: "morning-greeting",
      name: "早安问候",
      description: "每天早上8点播报天气和日程",
      cronExpression: "0 8 * * *",
      enabled: true,
      action: "voice",
      payload: {
        text: "早上好！今天是{date}，{weather}。您今天有{events}个日程安排。",
        dynamic: true,
      },
    });

    // 午餐提醒 (每天 12:00)
    this.tasks.push({
      id: "lunch-reminder",
      name: "午餐提醒",
      description: "每天中午12点提醒吃午餐",
      cronExpression: "0 12 * * *",
      enabled: true,
      action: "voice",
      payload: {
        text: "该吃午饭啦！记得休息一下哦。",
      },
    });

    // 晚安问候 (每天 22:00)
    this.tasks.push({
      id: "evening-greeting",
      name: "晚安问候",
      description: "每天晚上10点提醒休息",
      cronExpression: "0 22 * * *",
      enabled: true,
      action: "voice",
      payload: {
        text: "晚上好！今天辛苦了，早点休息吧。明天又是美好的一天！",
      },
    });

    // 每小时健康检查 (每小时整点)
    this.tasks.push({
      id: "hourly-health-check",
      name: "设备健康检查",
      description: "每小时检查设备状态",
      cronExpression: "0 * * * *",
      enabled: true,
      action: "custom",
      payload: {
        handler: "health-check",
      },
    });

    // 工作日提醒 (周一到周五 9:00)
    this.tasks.push({
      id: "workday-reminder",
      name: "工作日提醒",
      description: "工作日早上9点提醒开始工作",
      cronExpression: "0 9 * * 1-5",
      enabled: true,
      action: "voice",
      payload: {
        text: "新的一天开始了！今天要加油哦！",
      },
    });

    // 周报提醒 (每周五 17:00)
    this.tasks.push({
      id: "weekly-report",
      name: "周报提醒",
      description: "每周五下午5点提醒写周报",
      cronExpression: "0 17 * * 5",
      enabled: true,
      action: "voice",
      payload: {
        text: "别忘了写周报哦！本周你已经处理了{tasks}个任务。",
        dynamic: true,
      },
    });

    // 每30分钟活动提醒 (工作时间)
    this.tasks.push({
      id: "activity-reminder",
      name: "活动提醒",
      description: "工作时间每30分钟提醒活动",
      cronExpression: "*/30 9-18 * * 1-5",
      enabled: false, // 默认关闭，用户可开启
      action: "voice",
      payload: {
        text: "该起来活动一下啦！",
      },
    });

    // 夜间静音模式 (每天 23:00 - 7:00)
    this.tasks.push({
      id: "night-mode-on",
      name: "开启夜间模式",
      description: "晚上11点开启静音模式",
      cronExpression: "0 23 * * *",
      enabled: true,
      action: "custom",
      payload: {
        handler: "night-mode",
        enabled: true,
      },
    });

    this.tasks.push({
      id: "night-mode-off",
      name: "关闭夜间模式",
      description: "早上7点关闭静音模式",
      cronExpression: "0 7 * * *",
      enabled: true,
      action: "custom",
      payload: {
        handler: "night-mode",
        enabled: false,
      },
    });

    logger.info(`Loaded ${this.tasks.length} predefined tasks`);
  }

  private scheduleTask(task: ScheduledTask): void {
    try {
      const job = new CronJob(
        task.cronExpression,
        async () => {
          await this.executeTask(task);
        },
        null,
        true,
        "Asia/Shanghai", // 时区
      );

      this.jobs.set(task.id, job);
      logger.info(`✅ Scheduled task: ${task.name} (${task.cronExpression})`);
    } catch (error) {
      logger.error(`Failed to schedule task ${task.name}:`, error);
    }
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    logger.info(`⏰ Executing task: ${task.name}`);

    try {
      switch (task.action) {
        case "voice":
          await this.executeVoiceTask(task);
          break;

        case "notification":
          await this.executeNotificationTask(task);
          break;

        case "function-call":
          await this.executeFunctionCallTask(task);
          break;

        case "custom":
          await this.executeCustomTask(task);
          break;

        default:
          logger.warn(`Unknown task action: ${task.action}`);
      }

      logger.info(`✅ Task completed: ${task.name}`);
    } catch (error) {
      logger.error(`Task execution failed: ${task.name}`, error);
    }
  }

  private async executeVoiceTask(task: ScheduledTask): Promise<void> {
    let text = task.payload.text;

    // 处理动态内容
    if (task.payload.dynamic) {
      text = await this.processDynamicContent(text);
    }

    // 发送到指定设备或广播
    if (task.deviceId) {
      await this.deviceManager.sendVoiceMessage(task.deviceId, text, true);
    } else {
      await this.deviceManager.broadcastVoiceMessage(text, true);
    }
  }

  private async executeNotificationTask(task: ScheduledTask): Promise<void> {
    // 发送通知到 OpenClaw 频道
    const message = task.payload.text || task.payload.message;

    for (const channel of this.config.openclaw.notifyChannels) {
      try {
        await fetch(`${this.config.openclaw.gatewayUrl}/api/messages/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel,
            userId: this.config.openclaw.adminUserId,
            text: `⏰ ${task.name}\n${message}`,
          }),
        });
      } catch (error) {
        logger.error(`Failed to send notification to ${channel}:`, error);
      }
    }
  }

  private async executeFunctionCallTask(task: ScheduledTask): Promise<void> {
    // 执行 Function Call
    const { functionName, parameters } = task.payload;

    // 这里可以调用 MCP 工具或其他功能
    logger.info(`Executing function: ${functionName}`);
  }

  private async executeCustomTask(task: ScheduledTask): Promise<void> {
    const handler = task.payload.handler;

    switch (handler) {
      case "health-check":
        await this.performHealthCheck();
        break;

      case "night-mode":
        await this.toggleNightMode(task.payload.enabled);
        break;

      default:
        logger.warn(`Unknown custom handler: ${handler}`);
    }
  }

  private async processDynamicContent(text: string): Promise<string> {
    // 替换动态占位符
    const now = new Date();
    const dateStr = now.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    });

    text = text.replace("{date}", dateStr);

    // 获取天气（示例）
    if (text.includes("{weather}")) {
      const weather = await this.getWeather();
      text = text.replace("{weather}", weather);
    }

    // 获取日程数量（示例）
    if (text.includes("{events}")) {
      const events = await this.getTodayEvents();
      text = text.replace("{events}", events.toString());
    }

    // 获取任务统计（示例）
    if (text.includes("{tasks}")) {
      const tasks = await this.getWeeklyTasks();
      text = text.replace("{tasks}", tasks.toString());
    }

    return text;
  }

  private async performHealthCheck(): Promise<void> {
    const status = await this.deviceManager.getStatus();

    // 检查离线设备
    const offlineDevices = status.devices.filter((d: any) => !d.online);

    if (offlineDevices.length > 0) {
      const deviceNames = offlineDevices.map((d: any) => d.name).join(", ");
      logger.warn(`⚠️ Offline devices: ${deviceNames}`);

      // 发送告警通知
      await fetch(`${this.config.openclaw.gatewayUrl}/api/messages/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: this.config.openclaw.controlChannel,
          userId: this.config.openclaw.adminUserId,
          text: `⚠️ 设备离线告警\n以下设备离线: ${deviceNames}`,
        }),
      });
    }
  }

  private async toggleNightMode(enabled: boolean): Promise<void> {
    logger.info(`${enabled ? "🌙 Enabling" : "☀️ Disabling"} night mode`);

    // 这里可以实现夜间模式逻辑
    // 例如：降低音量、关闭某些通知等
  }

  // 示例：获取天气
  private async getWeather(): Promise<string> {
    // 实际实现需要调用天气 API
    return "晴天，气温 20-28℃";
  }

  // 示例：获取今日日程
  private async getTodayEvents(): Promise<number> {
    // 实际实现需要调用日历 API
    return 3;
  }

  // 示例：获取本周任务统计
  private async getWeeklyTasks(): Promise<number> {
    // 实际实现需要查询任务数据库
    return 15;
  }

  // 添加自定义任务
  addTask(task: ScheduledTask): void {
    this.tasks.push(task);

    if (task.enabled) {
      this.scheduleTask(task);
    }

    logger.info(`Added task: ${task.name}`);
  }

  // 移除任务
  removeTask(taskId: string): void {
    const job = this.jobs.get(taskId);
    if (job) {
      job.stop();
      this.jobs.delete(taskId);
    }

    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    logger.info(`Removed task: ${taskId}`);
  }

  // 启用/禁用任务
  toggleTask(taskId: string, enabled: boolean): void {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) {
      logger.warn(`Task not found: ${taskId}`);
      return;
    }

    task.enabled = enabled;

    if (enabled) {
      this.scheduleTask(task);
    } else {
      const job = this.jobs.get(taskId);
      if (job) {
        job.stop();
        this.jobs.delete(taskId);
      }
    }

    logger.info(`Task ${taskId} ${enabled ? "enabled" : "disabled"}`);
  }

  // 列出所有任务
  listTasks(): ScheduledTask[] {
    return this.tasks;
  }

  // 手动执行任务
  async runTask(taskId: string): Promise<void> {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    logger.info(`Manually executing task: ${task.name}`);
    await this.executeTask(task);
  }
}
