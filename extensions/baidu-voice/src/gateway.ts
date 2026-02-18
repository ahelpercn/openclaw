/**
 * Baidu Voice Gateway
 * 管理与百度语音服务的 WebSocket 连接
 */

import { EventEmitter } from "events";
import type { PluginContext } from "openclaw/plugin-sdk";
import WebSocket from "ws";
import type { BaiduVoiceConfig } from "./index";
import { logger } from "./utils/logger";

export interface BaiduMessage {
  type: "asr" | "llm" | "event" | "function-call" | "custom";
  deviceId: string;
  data: any;
  timestamp: number;
}

export class BaiduVoiceGateway extends EventEmitter {
  private config: BaiduVoiceConfig;
  private context: PluginContext;
  private connections: Map<string, WebSocket> = new Map();
  private sessionTokens: Map<string, { instanceId: string; token: string }> = new Map();

  constructor(config: BaiduVoiceConfig, context: PluginContext) {
    super();
    this.config = config;
    this.context = context;
  }

  async start(): Promise<void> {
    logger.info("🌐 Starting Baidu Voice Gateway...");

    // 为每个设备建立连接
    for (const device of this.config.devices) {
      if (device.autoConnect) {
        await this.connectDevice(device.deviceId);
      }
    }
  }

  async stop(): Promise<void> {
    logger.info("🛑 Stopping Baidu Voice Gateway...");

    for (const [deviceId, ws] of this.connections) {
      ws.close();
      this.connections.delete(deviceId);
    }
  }

  async connectDevice(deviceId: string): Promise<void> {
    try {
      logger.info(`🔌 Connecting device: ${deviceId}`);

      // 获取会话 Token (连接方式一)
      const { instanceId, token } = await this.fetchSessionToken(deviceId);
      this.sessionTokens.set(deviceId, { instanceId, token });

      // 构建 WebSocket URL
      const url = this.buildWebSocketUrl(instanceId, token);

      // 创建 WebSocket 连接
      const ws = new WebSocket(url);

      ws.on("open", () => {
        logger.info(`✅ Device connected: ${deviceId}`);
        this.emit("device-connected", deviceId);
      });

      ws.on("message", (data: Buffer) => {
        this.handleMessage(deviceId, data);
      });

      ws.on("close", () => {
        logger.warn(`❌ Device disconnected: ${deviceId}`);
        this.connections.delete(deviceId);
        this.emit("device-disconnected", deviceId);

        // 自动重连
        if (this.config.features.autoReconnect) {
          setTimeout(() => this.connectDevice(deviceId), 5000);
        }
      });

      ws.on("error", (error) => {
        logger.error(`WebSocket error for ${deviceId}:`, error);
        this.emit("device-error", { deviceId, error });
      });

      this.connections.set(deviceId, ws);
    } catch (error) {
      logger.error(`Failed to connect device ${deviceId}:`, error);
      throw error;
    }
  }

  private async fetchSessionToken(
    deviceId: string,
  ): Promise<{ instanceId: string; token: string }> {
    // 调用百度 API 获取会话 Token
    // 这里需要根据实际的 OTA 服务器接口实现
    const response = await fetch(`${this.config.openclaw.gatewayUrl}/api/baidu/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        appId: this.config.baidu.appId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch session token: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      instanceId: data.ai_agent_instance_id.toString(),
      token: data.context.token,
    };
  }

  private buildWebSocketUrl(instanceId: string, token: string): string {
    const { wsUrl, appId, audioCodec } = this.config.baidu;
    return `${wsUrl}?a=${appId}&id=${instanceId}&t=${token}&ac=${audioCodec}`;
  }

  private handleMessage(deviceId: string, data: Buffer): void {
    const isBinary = data[0] !== 0x5b; // 不是 '[' 字符

    if (isBinary) {
      // 音频数据
      this.emit("audio-data", { deviceId, data });
    } else {
      // 文本消息
      const text = data.toString("utf-8");
      this.parseTextMessage(deviceId, text);
    }
  }

  private parseTextMessage(deviceId: string, text: string): void {
    // ASR 结果
    if (text.startsWith("[Q]:")) {
      const asrText = text.substring(4);
      this.emit("asr-result", {
        deviceId,
        text: asrText,
        final: true,
      });
    } else if (text.startsWith("[Q]:[M]:")) {
      const asrText = text.substring(8);
      this.emit("asr-result", {
        deviceId,
        text: asrText,
        final: false,
      });
    }
    // LLM 结果
    else if (text.startsWith("[A]:")) {
      const llmText = text.substring(4);
      this.emit("llm-result", {
        deviceId,
        text: llmText,
        final: true,
      });
    } else if (text.startsWith("[A]:[M]:")) {
      const llmText = text.substring(8);
      this.emit("llm-result", {
        deviceId,
        text: llmText,
        final: false,
      });
    }
    // Function Call
    else if (text.startsWith("[F]:")) {
      const jsonStr = text.substring(4);
      try {
        const data = JSON.parse(jsonStr);
        this.emit("function-call", {
          deviceId,
          sessionId: data.session_id,
          content: JSON.parse(data.content),
        });
      } catch (error) {
        logger.error("Failed to parse function call:", error);
      }
    }
    // 事件
    else if (text.startsWith("[E]:")) {
      this.handleEvent(deviceId, text);
    }
    // 自定义数据
    else if (text.startsWith("[C]:")) {
      const jsonStr = text.substring(4);
      try {
        const data = JSON.parse(jsonStr);
        this.emit("custom-data", { deviceId, data });
      } catch (error) {
        logger.error("Failed to parse custom data:", error);
      }
    }
  }

  private handleEvent(deviceId: string, event: string): void {
    if (event.includes("[TTS_BEGIN_SPEAKING]")) {
      this.emit("tts-start", { deviceId });
    } else if (event.includes("[TTS_END_SPEAKING]")) {
      this.emit("tts-end", { deviceId });
    } else if (event.includes("[MEDIA]:[READY]")) {
      this.emit("media-ready", { deviceId });
    } else if (event.includes("[VOICE_COMING]")) {
      this.emit("voice-coming", { deviceId });
    } else if (event.includes("[VOICE_DISAPPEAR]")) {
      this.emit("voice-disappear", { deviceId });
    }
  }

  // 发送文本到 AI
  async sendTextToAI(deviceId: string, text: string): Promise<void> {
    const ws = this.connections.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Device ${deviceId} not connected`);
    }

    ws.send(`[T]:${text}`);
    logger.debug(`📤 Sent to AI (${deviceId}): ${text}`);
  }

  // 发送 TTS 播报
  async sendTextToTTS(deviceId: string, text: string): Promise<void> {
    const ws = this.connections.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Device ${deviceId} not connected`);
    }

    ws.send(`[TTS]:${text}`);
    logger.debug(`📤 Sent to TTS (${deviceId}): ${text}`);
  }

  // 发送 Function Call 结果
  async sendFunctionCallResult(
    deviceId: string,
    sessionId: string,
    result: "ok" | "error",
    message: string,
  ): Promise<void> {
    const ws = this.connections.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Device ${deviceId} not connected`);
    }

    const payload = JSON.stringify({ session_id: sessionId, result, message });
    ws.send(`[F]:${payload}`);
    logger.debug(`📤 Sent function result (${deviceId}): ${result}`);
  }

  // 发送打断命令
  async sendInterrupt(deviceId: string): Promise<void> {
    const ws = this.connections.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Device ${deviceId} not connected`);
    }

    ws.send("[B]:");
    logger.debug(`📤 Sent interrupt (${deviceId})`);
  }

  // 检查设备连接状态
  isDeviceConnected(deviceId: string): boolean {
    const ws = this.connections.get(deviceId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }
}
