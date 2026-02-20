/**
 * Baidu Voice Gateway
 * 管理与百度语音服务的 WebSocket 连接
 */

import { EventEmitter } from "events";
import WebSocket from "ws";
import type { BaiduVoiceConfig } from "./index.js";
import { logger } from "./utils/logger.js";

export interface BaiduMessage {
  type: "asr" | "llm" | "event" | "function-call" | "custom";
  deviceId: string;
  data: unknown;
  timestamp: number;
}

type SessionTokenResponse = {
  ai_agent_instance_id: string | number;
  context?: {
    token?: string;
  };
};

type FunctionCallEnvelope = {
  session_id?: string;
  content?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class BaiduVoiceGateway extends EventEmitter {
  private config: BaiduVoiceConfig;
  private connections: Map<string, WebSocket> = new Map();
  private sessionTokens: Map<string, { instanceId: string; token: string }> = new Map();

  constructor(config: BaiduVoiceConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    logger.info("Starting Baidu Voice Gateway...");

    for (const device of this.config.devices) {
      if (device.autoConnect) {
        await this.connectDevice(device.deviceId);
      }
    }
  }

  async stop(): Promise<void> {
    logger.info("Stopping Baidu Voice Gateway...");

    for (const [deviceId, ws] of this.connections) {
      ws.close();
      this.connections.delete(deviceId);
    }
  }

  async connectDevice(deviceId: string): Promise<void> {
    try {
      logger.info(`Connecting device: ${deviceId}`);

      const { instanceId, token } = await this.fetchSessionToken(deviceId);
      this.sessionTokens.set(deviceId, { instanceId, token });

      const url = this.buildWebSocketUrl(instanceId, token);
      const ws = new WebSocket(url);

      ws.on("open", () => {
        logger.info(`Device connected: ${deviceId}`);
        this.emit("device-connected", deviceId);
      });

      ws.on("message", (data: WebSocket.RawData) => {
        const buffer = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : typeof data === "string"
              ? Buffer.from(data)
              : Buffer.from(data);
        this.handleMessage(deviceId, buffer);
      });

      ws.on("close", () => {
        logger.warn(`Device disconnected: ${deviceId}`);
        this.connections.delete(deviceId);
        this.emit("device-disconnected", deviceId);

        if (this.config.features.autoReconnect) {
          setTimeout(() => {
            void this.connectDevice(deviceId);
          }, 5000);
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

    const raw = (await response.json()) as unknown;
    if (!isRecord(raw)) {
      throw new Error("Invalid session token response");
    }

    const data = raw as SessionTokenResponse;
    const token = data.context?.token;
    if (!token) {
      throw new Error("Missing session token in response");
    }

    return {
      instanceId: String(data.ai_agent_instance_id),
      token,
    };
  }

  private buildWebSocketUrl(instanceId: string, token: string): string {
    const { wsUrl, appId, audioCodec } = this.config.baidu;
    return `${wsUrl}?a=${appId}&id=${instanceId}&t=${token}&ac=${audioCodec}`;
  }

  private handleMessage(deviceId: string, data: Buffer): void {
    const isBinary = data[0] !== 0x5b;

    if (isBinary) {
      this.emit("audio-data", { deviceId, data });
      return;
    }

    const text = data.toString("utf-8");
    this.parseTextMessage(deviceId, text);
  }

  private parseTextMessage(deviceId: string, text: string): void {
    if (text.startsWith("[Q]:")) {
      const asrText = text.substring(4);
      this.emit("asr-result", { deviceId, text: asrText, final: true });
      return;
    }

    if (text.startsWith("[Q]:[M]:")) {
      const asrText = text.substring(8);
      this.emit("asr-result", { deviceId, text: asrText, final: false });
      return;
    }

    if (text.startsWith("[A]:")) {
      const llmText = text.substring(4);
      this.emit("llm-result", { deviceId, text: llmText, final: true });
      return;
    }

    if (text.startsWith("[A]:[M]:")) {
      const llmText = text.substring(8);
      this.emit("llm-result", { deviceId, text: llmText, final: false });
      return;
    }

    if (text.startsWith("[F]:")) {
      const jsonStr = text.substring(4);
      try {
        const parsed = JSON.parse(jsonStr) as unknown;
        if (!isRecord(parsed)) {
          throw new Error("function-call envelope is not an object");
        }
        const data = parsed as FunctionCallEnvelope;
        const contentRaw = data.content;
        if (typeof contentRaw !== "string") {
          throw new Error("function-call content is not a string");
        }
        const content = JSON.parse(contentRaw) as unknown;
        this.emit("function-call", {
          deviceId,
          sessionId: typeof data.session_id === "string" ? data.session_id : "",
          content,
        });
      } catch (error) {
        logger.error("Failed to parse function call:", error);
      }
      return;
    }

    if (text.startsWith("[E]:")) {
      this.handleEvent(deviceId, text);
      return;
    }

    if (text.startsWith("[C]:")) {
      const jsonStr = text.substring(4);
      try {
        const data = JSON.parse(jsonStr) as unknown;
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

  async sendTextToAI(deviceId: string, text: string): Promise<void> {
    const ws = this.connections.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Device ${deviceId} not connected`);
    }

    ws.send(`[T]:${text}`);
    logger.debug(`Sent to AI (${deviceId}): ${text}`);
  }

  async sendTextToTTS(deviceId: string, text: string): Promise<void> {
    const ws = this.connections.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Device ${deviceId} not connected`);
    }

    ws.send(`[TTS]:${text}`);
    logger.debug(`Sent to TTS (${deviceId}): ${text}`);
  }

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
    logger.debug(`Sent function result (${deviceId}): ${result}`);
  }

  async sendInterrupt(deviceId: string): Promise<void> {
    const ws = this.connections.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Device ${deviceId} not connected`);
    }

    ws.send("[B]:");
    logger.debug(`Sent interrupt (${deviceId})`);
  }

  isDeviceConnected(deviceId: string): boolean {
    const ws = this.connections.get(deviceId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }
}
