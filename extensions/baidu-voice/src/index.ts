/**
 * OpenClaw Baidu Voice Plugin
 * 24小时AI员工 - 百度语音设备深度集成
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { DeviceManager } from "./device-manager.js";
import { BaiduVoiceGateway } from "./gateway.js";
import { MessageRouter } from "./message-router.js";
import { TaskScheduler } from "./task-scheduler.js";
import { logger } from "./utils/logger.js";

export interface BaiduVoiceConfig {
  baidu: {
    appId: string;
    ak?: string;
    sk?: string;
    wsUrl: string;
    audioCodec: "opus" | "opus_cbr_16000" | "raw16k";
  };
  openclaw: {
    gatewayUrl: string;
    controlChannel: string;
    adminUserId: string;
    notifyChannels: string[];
  };
  devices: Array<{
    deviceId: string;
    name: string;
    location: string;
    userId: string;
    capabilities: string[];
    autoConnect: boolean;
  }>;
  features: {
    autoReconnect: boolean;
    idleTimeout: number;
    healthCheckInterval: number;
    enableScheduledTasks: boolean;
    enableVoiceNotifications: boolean;
  };
  mcpTools: Record<
    string,
    {
      server: string;
      tool: string;
      description: string;
    }
  >;
}

type DeviceStatus = {
  onlineDevices: number;
  totalDevices: number;
  activeSessions: number;
  todayMessages: number;
  uptime: number;
  devices: Array<{ name: string; location: string; online: boolean; status: string }>;
};

type CommandHandler = (ctx: { args?: string }) => Promise<{ text: string }> | { text: string };

class BaiduVoiceRuntime {
  private readonly api: OpenClawPluginApi;
  private config!: BaiduVoiceConfig;
  private gateway!: BaiduVoiceGateway;
  private deviceManager!: DeviceManager;
  private messageRouter!: MessageRouter;
  private taskScheduler!: TaskScheduler;
  private started = false;
  private apiRegistered = false;
  private deviceEventsBound = false;

  constructor(api: OpenClawPluginApi) {
    this.api = api;
  }

  registerApi(): void {
    if (this.apiRegistered) {
      return;
    }
    this.registerCommands();
    this.registerMessageHook();
    this.apiRegistered = true;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.config = loadConfig();
    logger.info("Initializing Baidu Voice plugin...");

    this.gateway = new BaiduVoiceGateway(this.config);
    this.deviceManager = new DeviceManager(this.config, this.gateway);
    this.messageRouter = new MessageRouter(this.config, this.gateway, this.deviceManager);
    this.taskScheduler = new TaskScheduler(this.config, this.gateway, this.deviceManager);

    await this.gateway.start();
    await this.deviceManager.start();
    await this.messageRouter.start();

    if (this.config.features.enableScheduledTasks) {
      await this.taskScheduler.start();
    }

    this.registerDeviceEvents();
    this.started = true;

    await this.sendNotification("24小时AI员工已上线，随时为您服务！");
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.sendNotification("AI员工下班中...");
    await this.taskScheduler.stop();
    await this.messageRouter.stop();
    await this.deviceManager.stop();
    await this.gateway.stop();
    this.started = false;
    logger.info("Baidu Voice plugin stopped");
  }

  private registerCommands(): void {
    const registerAlias = (
      name: string,
      description: string,
      handler: CommandHandler,
      acceptsArgs = false,
    ) => {
      this.api.registerCommand({ name, description, acceptsArgs, handler });
    };

    const statusHandler: CommandHandler = async () => {
      if (!this.started) {
        return { text: "baidu-voice 服务未启动，请先检查配置并重启 gateway。" };
      }
      const status = (await this.deviceManager.getStatus()) as DeviceStatus;
      return { text: this.formatStatus(status) };
    };

    const devicesHandler: CommandHandler = async () => {
      if (!this.started) {
        return { text: "baidu-voice 服务未启动，请先检查配置并重启 gateway。" };
      }
      const devices = await this.deviceManager.listDevices();
      return { text: this.formatDeviceList(devices) };
    };

    const reconnectHandler: CommandHandler = async (ctx) => {
      if (!this.started) {
        return { text: "baidu-voice 服务未启动，请先检查配置并重启 gateway。" };
      }
      const deviceId = (ctx.args ?? "").trim().split(/\s+/)[0] ?? "";
      if (!deviceId) {
        return { text: "用法: /baidu-reconnect <deviceId>" };
      }
      await this.deviceManager.reconnectDevice(deviceId);
      return { text: `设备 ${deviceId} 重连中...` };
    };

    const ttsHandler: CommandHandler = async (ctx) => {
      if (!this.started) {
        return { text: "baidu-voice 服务未启动，请先检查配置并重启 gateway。" };
      }
      const raw = (ctx.args ?? "").trim();
      const [deviceId, ...parts] = raw.split(/\s+/).filter(Boolean);
      const text = parts.join(" ").trim();
      if (!deviceId || !text) {
        return { text: "用法: /baidu-tts <deviceId> <text>" };
      }
      await this.deviceManager.sendTtsMessage(deviceId, text);
      return { text: `已发送语音到 ${deviceId}: ${text}` };
    };

    registerAlias("baidu-status", "查看百度语音设备状态", statusHandler);

    registerAlias("baidu-devices", "列出百度语音设备", devicesHandler);

    registerAlias("baidu-reconnect", "重连百度语音设备", reconnectHandler, true);

    registerAlias("baidu-tts", "独立 TTS：让指定设备播报文本（百度 WS）", ttsHandler, true);
    registerAlias(
      "baidu-speak",
      "兼容命令：让指定设备播报文本（等同 baidu-tts）",
      ttsHandler,
      true,
    );
  }

  private registerDeviceEvents(): void {
    if (this.deviceEventsBound) {
      return;
    }
    this.deviceManager.on("device-online", async (device: { name: string; location: string }) => {
      await this.sendNotification(`设备上线: ${device.name} (${device.location})`);
    });

    this.deviceManager.on("device-offline", async (device: { name: string; location: string }) => {
      await this.sendNotification(`设备离线: ${device.name} (${device.location})`);
    });

    this.deviceManager.on("voice-command", async (data: unknown) => {
      await this.messageRouter.routeVoiceCommand(
        data as Parameters<MessageRouter["routeVoiceCommand"]>[0],
      );
    });

    this.deviceManager.on("function-call", async (data: unknown) => {
      await this.messageRouter.handleFunctionCall(
        data as Parameters<MessageRouter["handleFunctionCall"]>[0],
      );
    });
    this.deviceEventsBound = true;
  }

  private registerMessageHook(): void {
    this.api.on("message_received", async (event: any, ctx: any) => {
      if (!this.started) {
        return;
      }
      await this.messageRouter.routeMessage({
        channel: ctx.channelId,
        text: event.content,
        metadata: event.metadata ?? {},
        from: event.from,
      });
    });
  }

  private async sendNotification(text: string): Promise<void> {
    for (const channel of this.config.openclaw.notifyChannels) {
      try {
        await fetch(`${this.config.openclaw.gatewayUrl}/api/messages/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel,
            userId: this.config.openclaw.adminUserId,
            text,
          }),
        });
      } catch (error) {
        logger.error(`Failed to send notification to ${channel}:`, error);
      }
    }
  }

  private formatStatus(status: DeviceStatus): string {
    const lines = [
      "百度语音设备状态",
      "",
      `在线设备: ${status.onlineDevices}/${status.totalDevices}`,
      `活跃会话: ${status.activeSessions}`,
      `今日消息: ${status.todayMessages}`,
      `运行时长(秒): ${Math.floor(status.uptime)}`,
      "",
      "设备列表:",
    ];

    for (const device of status.devices) {
      const icon = device.online ? "[ON]" : "[OFF]";
      lines.push(`${icon} ${device.name} (${device.location}) - ${device.status}`);
    }

    return lines.join("\n");
  }

  private formatDeviceList(
    devices: Array<{
      name: string;
      location: string;
      deviceId: string;
      online: boolean;
      capabilities: string[];
    }>,
  ): string {
    const lines = ["已注册设备:", ""];

    for (const device of devices) {
      lines.push(`- ${device.name}`);
      lines.push(`  位置: ${device.location}`);
      lines.push(`  ID: ${device.deviceId}`);
      lines.push(`  状态: ${device.online ? "在线" : "离线"}`);
      lines.push(`  能力: ${device.capabilities.join(", ")}`);
      lines.push("");
    }

    return lines.join("\n");
  }
}

function parseAudioCodec(value: string | undefined): BaiduVoiceConfig["baidu"]["audioCodec"] {
  if (value === "opus" || value === "raw16k") {
    return value;
  }
  return "opus_cbr_16000";
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw || !raw.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadConfig(): BaiduVoiceConfig {
  return {
    baidu: {
      appId: process.env.BAIDU_APP_ID || "",
      ak: process.env.BAIDU_AK,
      sk: process.env.BAIDU_SK,
      wsUrl: process.env.BAIDU_WS_URL || "wss://rtc-aiotgw.exp.bcelive.com/v1/realtime",
      audioCodec: parseAudioCodec(process.env.BAIDU_AUDIO_CODEC),
    },
    openclaw: {
      gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || "http://localhost:18789",
      controlChannel: process.env.OPENCLAW_CONTROL_CHANNEL || "telegram",
      adminUserId: process.env.OPENCLAW_ADMIN_USER_ID || "",
      notifyChannels: (process.env.OPENCLAW_NOTIFY_CHANNELS || "telegram")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    },
    devices: parseJson(process.env.BAIDU_DEVICES, []),
    features: {
      autoReconnect: process.env.BAIDU_AUTO_RECONNECT !== "false",
      idleTimeout: Number.parseInt(process.env.BAIDU_IDLE_TIMEOUT || "180", 10),
      healthCheckInterval: Number.parseInt(process.env.BAIDU_HEALTH_CHECK_INTERVAL || "30", 10),
      enableScheduledTasks: process.env.BAIDU_ENABLE_SCHEDULED_TASKS !== "false",
      enableVoiceNotifications: process.env.BAIDU_ENABLE_VOICE_NOTIFICATIONS !== "false",
    },
    mcpTools: parseJson(process.env.BAIDU_MCP_TOOLS, {}),
  };
}

const plugin = {
  id: "baidu-voice",
  name: "Baidu Voice",
  description: "Baidu voice device integration for OpenClaw",
  register(api: OpenClawPluginApi) {
    const runtime = new BaiduVoiceRuntime(api);
    runtime.registerApi();

    api.registerService({
      id: "baidu-voice",
      start: async () => {
        try {
          await runtime.start();
        } catch (error) {
          api.logger.error(
            `[baidu-voice] failed to start: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
      stop: async () => {
        try {
          await runtime.stop();
        } catch (error) {
          api.logger.error(
            `[baidu-voice] failed to stop: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    });
  },
};

export default plugin;
