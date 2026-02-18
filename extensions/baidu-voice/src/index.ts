/**
 * OpenClaw Baidu Voice Plugin
 * 24小时AI员工 - 百度语音设备深度集成
 */

import type { Plugin, PluginContext } from "openclaw/plugin-sdk";
import { DeviceManager } from "./device-manager";
import { BaiduVoiceGateway } from "./gateway";
import { MessageRouter } from "./message-router";
import { TaskScheduler } from "./task-scheduler";
import { logger } from "./utils/logger";

export interface BaiduVoiceConfig {
  // 百度服务配置
  baidu: {
    appId: string;
    ak?: string;
    sk?: string;
    wsUrl: string;
    audioCodec: "opus" | "opus_cbr_16000" | "raw16k";
  };

  // OpenClaw 集成配置
  openclaw: {
    gatewayUrl: string;
    controlChannel: string; // 主控频道 (如 telegram)
    adminUserId: string; // 管理员ID
    notifyChannels: string[]; // 通知频道列表
  };

  // 设备配置
  devices: Array<{
    deviceId: string;
    name: string;
    location: string;
    userId: string;
    capabilities: string[];
    autoConnect: boolean;
  }>;

  // 功能配置
  features: {
    autoReconnect: boolean;
    idleTimeout: number; // 秒
    healthCheckInterval: number; // 秒
    enableScheduledTasks: boolean;
    enableVoiceNotifications: boolean;
  };

  // MCP 工具映射
  mcpTools: Record<
    string,
    {
      server: string;
      tool: string;
      description: string;
    }
  >;
}

export default class BaiduVoicePlugin implements Plugin {
  name = "baidu-voice";
  version = "1.0.0";

  private context!: PluginContext;
  private config!: BaiduVoiceConfig;
  private gateway!: BaiduVoiceGateway;
  private deviceManager!: DeviceManager;
  private messageRouter!: MessageRouter;
  private taskScheduler!: TaskScheduler;

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    this.config = this.loadConfig();

    logger.info("🚀 Initializing Baidu Voice Plugin...");

    // 初始化核心组件
    this.gateway = new BaiduVoiceGateway(this.config, context);
    this.deviceManager = new DeviceManager(this.config, this.gateway);
    this.messageRouter = new MessageRouter(this.config, this.gateway, this.deviceManager);
    this.taskScheduler = new TaskScheduler(this.config, this.gateway, this.deviceManager);

    // 启动服务
    await this.gateway.start();
    await this.deviceManager.start();
    await this.messageRouter.start();

    if (this.config.features.enableScheduledTasks) {
      await this.taskScheduler.start();
    }

    // 注册命令处理器
    this.registerCommands();

    // 注册事件监听器
    this.registerEventHandlers();

    logger.info("✅ Baidu Voice Plugin initialized successfully");

    // 发送启动通知
    await this.sendNotification("🤖 24小时AI员工已上线，随时为您服务！");
  }

  async shutdown(): Promise<void> {
    logger.info("🛑 Shutting down Baidu Voice Plugin...");

    await this.sendNotification("🌙 AI员工下班中...");

    await this.taskScheduler?.stop();
    await this.messageRouter?.stop();
    await this.deviceManager?.stop();
    await this.gateway?.stop();

    logger.info("✅ Baidu Voice Plugin shutdown complete");
  }

  private loadConfig(): BaiduVoiceConfig {
    // 从环境变量和配置文件加载配置
    const config: BaiduVoiceConfig = {
      baidu: {
        appId: process.env.BAIDU_APP_ID || "",
        ak: process.env.BAIDU_AK,
        sk: process.env.BAIDU_SK,
        wsUrl: process.env.BAIDU_WS_URL || "wss://rtc-aiotgw.exp.bcelive.com/v1/realtime",
        audioCodec: (process.env.BAIDU_AUDIO_CODEC as any) || "opus_cbr_16000",
      },
      openclaw: {
        gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || "http://localhost:18789",
        controlChannel: process.env.OPENCLAW_CONTROL_CHANNEL || "telegram",
        adminUserId: process.env.OPENCLAW_ADMIN_USER_ID || "",
        notifyChannels: (process.env.OPENCLAW_NOTIFY_CHANNELS || "telegram").split(","),
      },
      devices: JSON.parse(process.env.BAIDU_DEVICES || "[]"),
      features: {
        autoReconnect: process.env.BAIDU_AUTO_RECONNECT !== "false",
        idleTimeout: parseInt(process.env.BAIDU_IDLE_TIMEOUT || "180"),
        healthCheckInterval: parseInt(process.env.BAIDU_HEALTH_CHECK_INTERVAL || "30"),
        enableScheduledTasks: process.env.BAIDU_ENABLE_SCHEDULED_TASKS !== "false",
        enableVoiceNotifications: process.env.BAIDU_ENABLE_VOICE_NOTIFICATIONS !== "false",
      },
      mcpTools: JSON.parse(process.env.BAIDU_MCP_TOOLS || "{}"),
    };

    return config;
  }

  private registerCommands(): void {
    // 注册 OpenClaw 命令
    this.context.registerCommand("baidu-status", async (args) => {
      const status = await this.deviceManager.getStatus();
      return this.formatStatus(status);
    });

    this.context.registerCommand("baidu-speak", async (args) => {
      const { deviceId, text } = args;
      await this.deviceManager.sendVoiceMessage(deviceId, text);
      return `✅ 已发送语音: ${text}`;
    });

    this.context.registerCommand("baidu-devices", async () => {
      const devices = await this.deviceManager.listDevices();
      return this.formatDeviceList(devices);
    });

    this.context.registerCommand("baidu-reconnect", async (args) => {
      const { deviceId } = args;
      await this.deviceManager.reconnectDevice(deviceId);
      return `🔄 设备 ${deviceId} 重连中...`;
    });
  }

  private registerEventHandlers(): void {
    // 监听设备事件
    this.deviceManager.on("device-online", async (device) => {
      await this.sendNotification(`📱 设备上线: ${device.name} (${device.location})`);
    });

    this.deviceManager.on("device-offline", async (device) => {
      await this.sendNotification(`⚠️ 设备离线: ${device.name} (${device.location})`);
    });

    this.deviceManager.on("voice-command", async (data) => {
      logger.info(`🎤 收到语音指令: ${data.text} (设备: ${data.deviceId})`);
      await this.messageRouter.routeVoiceCommand(data);
    });

    this.deviceManager.on("function-call", async (data) => {
      logger.info(`🔧 Function Call: ${data.functionName}`);
      await this.messageRouter.handleFunctionCall(data);
    });

    // 监听 OpenClaw 消息
    this.context.on("message", async (message) => {
      await this.messageRouter.routeMessage(message);
    });
  }

  private async sendNotification(text: string): Promise<void> {
    for (const channel of this.config.openclaw.notifyChannels) {
      try {
        await this.context.sendMessage({
          channel,
          userId: this.config.openclaw.adminUserId,
          text,
        });
      } catch (error) {
        logger.error(`Failed to send notification to ${channel}:`, error);
      }
    }
  }

  private formatStatus(status: any): string {
    const lines = [
      "📊 百度语音设备状态",
      "",
      `在线设备: ${status.onlineDevices}/${status.totalDevices}`,
      `活跃会话: ${status.activeSessions}`,
      `今日消息: ${status.todayMessages}`,
      `运行时长: ${status.uptime}`,
      "",
      "设备列表:",
    ];

    for (const device of status.devices) {
      const icon = device.online ? "🟢" : "🔴";
      lines.push(`${icon} ${device.name} (${device.location}) - ${device.status}`);
    }

    return lines.join("\n");
  }

  private formatDeviceList(devices: any[]): string {
    const lines = ["📱 已注册设备:", ""];

    for (const device of devices) {
      lines.push(`• ${device.name}`);
      lines.push(`  位置: ${device.location}`);
      lines.push(`  ID: ${device.deviceId}`);
      lines.push(`  状态: ${device.online ? "🟢 在线" : "🔴 离线"}`);
      lines.push(`  能力: ${device.capabilities.join(", ")}`);
      lines.push("");
    }

    return lines.join("\n");
  }
}
