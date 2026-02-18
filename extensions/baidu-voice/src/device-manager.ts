/**
 * Device Manager
 * 管理多个 ESP32 语音设备的生命周期、健康检查和状态追踪
 */

import { EventEmitter } from "events";
import type { BaiduVoiceGateway } from "./gateway";
import type { BaiduVoiceConfig } from "./index";
import { logger } from "./utils/logger";

export interface Device {
  deviceId: string;
  name: string;
  location: string;
  userId: string;
  capabilities: string[];
  online: boolean;
  lastSeen: Date;
  sessionCount: number;
  messageCount: number;
}

export interface VoiceCommandData {
  deviceId: string;
  text: string;
  final: boolean;
  timestamp: Date;
  userId: string;
}

export interface FunctionCallData {
  deviceId: string;
  sessionId: string;
  functionName: string;
  parameters: Record<string, any>;
  timestamp: Date;
}

export class DeviceManager extends EventEmitter {
  private config: BaiduVoiceConfig;
  private gateway: BaiduVoiceGateway;
  private devices: Map<string, Device> = new Map();
  private healthCheckTimer?: NodeJS.Timeout;
  private sessionData: Map<string, any> = new Map();

  constructor(config: BaiduVoiceConfig, gateway: BaiduVoiceGateway) {
    super();
    this.config = config;
    this.gateway = gateway;
  }

  async start(): Promise<void> {
    logger.info("📱 Starting Device Manager...");

    // 初始化设备列表
    for (const deviceConfig of this.config.devices) {
      const device: Device = {
        deviceId: deviceConfig.deviceId,
        name: deviceConfig.name,
        location: deviceConfig.location,
        userId: deviceConfig.userId,
        capabilities: deviceConfig.capabilities,
        online: false,
        lastSeen: new Date(),
        sessionCount: 0,
        messageCount: 0,
      };
      this.devices.set(deviceConfig.deviceId, device);
    }

    // 注册网关事件监听
    this.registerGatewayEvents();

    // 启动健康检查
    this.startHealthCheck();

    logger.info(`✅ Device Manager started with ${this.devices.size} devices`);
  }

  async stop(): Promise<void> {
    logger.info("🛑 Stopping Device Manager...");

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.devices.clear();
    this.sessionData.clear();
  }

  private registerGatewayEvents(): void {
    // 设备连接事件
    this.gateway.on("device-connected", (deviceId: string) => {
      const device = this.devices.get(deviceId);
      if (device) {
        device.online = true;
        device.lastSeen = new Date();
        this.emit("device-online", device);
        logger.info(`✅ Device online: ${device.name}`);
      }
    });

    // 设备断开事件
    this.gateway.on("device-disconnected", (deviceId: string) => {
      const device = this.devices.get(deviceId);
      if (device) {
        device.online = false;
        this.emit("device-offline", device);
        logger.warn(`❌ Device offline: ${device.name}`);
      }
    });

    // ASR 结果
    this.gateway.on("asr-result", (data: any) => {
      const device = this.devices.get(data.deviceId);
      if (device && data.final) {
        device.messageCount++;
        device.lastSeen = new Date();

        const commandData: VoiceCommandData = {
          deviceId: data.deviceId,
          text: data.text,
          final: data.final,
          timestamp: new Date(),
          userId: device.userId,
        };

        this.emit("voice-command", commandData);
      }
    });

    // LLM 结果
    this.gateway.on("llm-result", (data: any) => {
      const device = this.devices.get(data.deviceId);
      if (device && data.final) {
        device.lastSeen = new Date();
        this.emit("llm-response", {
          deviceId: data.deviceId,
          text: data.text,
          timestamp: new Date(),
        });
      }
    });

    // Function Call
    this.gateway.on("function-call", (data: any) => {
      const device = this.devices.get(data.deviceId);
      if (device) {
        device.lastSeen = new Date();

        const functionCallData: FunctionCallData = {
          deviceId: data.deviceId,
          sessionId: data.sessionId,
          functionName: data.content.function_name,
          parameters: data.content.parameter_list?.[0] || {},
          timestamp: new Date(),
        };

        this.emit("function-call", functionCallData);
      }
    });

    // TTS 事件
    this.gateway.on("tts-start", (data: any) => {
      this.emit("tts-start", data);
    });

    this.gateway.on("tts-end", (data: any) => {
      this.emit("tts-end", data);
    });
  }

  private startHealthCheck(): void {
    const interval = this.config.features.healthCheckInterval * 1000;

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, interval);

    logger.info(`🏥 Health check started (interval: ${this.config.features.healthCheckInterval}s)`);
  }

  private performHealthCheck(): void {
    const now = new Date();

    for (const [deviceId, device] of this.devices) {
      const timeSinceLastSeen = now.getTime() - device.lastSeen.getTime();
      const timeoutMs = this.config.features.idleTimeout * 1000;

      // 检查设备是否超时
      if (device.online && timeSinceLastSeen > timeoutMs) {
        logger.warn(`⚠️ Device ${device.name} idle for ${Math.floor(timeSinceLastSeen / 1000)}s`);
      }

      // 检查连接状态
      const isConnected = this.gateway.isDeviceConnected(deviceId);
      if (device.online !== isConnected) {
        device.online = isConnected;
        if (isConnected) {
          this.emit("device-online", device);
        } else {
          this.emit("device-offline", device);
        }
      }
    }
  }

  // 发送语音消息到设备
  async sendVoiceMessage(deviceId: string, text: string, useTTS = true): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    if (!device.online) {
      throw new Error(`Device offline: ${device.name}`);
    }

    if (useTTS) {
      // 直接 TTS 播报（不经过 LLM）
      await this.gateway.sendTextToTTS(deviceId, text);
    } else {
      // 发送给 AI 处理
      await this.gateway.sendTextToAI(deviceId, text);
    }

    logger.info(`📤 Sent voice message to ${device.name}: ${text}`);
  }

  // 发送 Function Call 结果
  async sendFunctionCallResult(
    deviceId: string,
    sessionId: string,
    success: boolean,
    message: string,
  ): Promise<void> {
    await this.gateway.sendFunctionCallResult(
      deviceId,
      sessionId,
      success ? "ok" : "error",
      message,
    );
  }

  // 打断当前播放
  async interruptDevice(deviceId: string): Promise<void> {
    await this.gateway.sendInterrupt(deviceId);
    logger.info(`⏸️ Interrupted device: ${deviceId}`);
  }

  // 重连设备
  async reconnectDevice(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    logger.info(`🔄 Reconnecting device: ${device.name}`);
    await this.gateway.connectDevice(deviceId);
  }

  // 获取设备状态
  async getStatus(): Promise<any> {
    const devices = Array.from(this.devices.values());
    const onlineDevices = devices.filter((d) => d.online).length;
    const totalMessages = devices.reduce((sum, d) => sum + d.messageCount, 0);

    return {
      totalDevices: devices.length,
      onlineDevices,
      activeSessions: this.sessionData.size,
      todayMessages: totalMessages,
      uptime: process.uptime(),
      devices: devices.map((d) => ({
        name: d.name,
        location: d.location,
        online: d.online,
        status: d.online ? "在线" : "离线",
        lastSeen: d.lastSeen,
        messageCount: d.messageCount,
      })),
    };
  }

  // 列出所有设备
  async listDevices(): Promise<Device[]> {
    return Array.from(this.devices.values());
  }

  // 获取设备信息
  getDevice(deviceId: string): Device | undefined {
    return this.devices.get(deviceId);
  }

  // 查找设备（按名称或位置）
  findDevice(query: string): Device | undefined {
    for (const device of this.devices.values()) {
      if (
        device.name.toLowerCase().includes(query.toLowerCase()) ||
        device.location.toLowerCase().includes(query.toLowerCase())
      ) {
        return device;
      }
    }
    return undefined;
  }

  // 广播消息到所有在线设备
  async broadcastVoiceMessage(text: string, useTTS = true): Promise<void> {
    const onlineDevices = Array.from(this.devices.values()).filter((d) => d.online);

    logger.info(`📢 Broadcasting to ${onlineDevices.length} devices: ${text}`);

    const promises = onlineDevices.map((device) =>
      this.sendVoiceMessage(device.deviceId, text, useTTS).catch((error) => {
        logger.error(`Failed to broadcast to ${device.name}:`, error);
      }),
    );

    await Promise.all(promises);
  }
}
