/**
 * Message Router
 * 路由消息在语音设备、OpenClaw 频道和 MCP 服务器之间
 */

import type { DeviceManager, VoiceCommandData, FunctionCallData } from "./device-manager.js";
import type { BaiduVoiceGateway } from "./gateway.js";
import type { BaiduVoiceConfig } from "./index.js";
import { logger } from "./utils/logger.js";

export class MessageRouter {
  private config: BaiduVoiceConfig;
  private gateway: BaiduVoiceGateway;
  private deviceManager: DeviceManager;
  private conversationHistory: Map<string, any[]> = new Map();

  constructor(config: BaiduVoiceConfig, gateway: BaiduVoiceGateway, deviceManager: DeviceManager) {
    this.config = config;
    this.gateway = gateway;
    this.deviceManager = deviceManager;
  }

  async start(): Promise<void> {
    logger.info("🔀 Starting Message Router...");
  }

  async stop(): Promise<void> {
    logger.info("🛑 Stopping Message Router...");
    this.conversationHistory.clear();
  }

  /**
   * 路由语音指令
   * 语音设备 -> OpenClaw 频道
   */
  async routeVoiceCommand(data: VoiceCommandData): Promise<void> {
    const device = this.deviceManager.getDevice(data.deviceId);
    if (!device) {
      logger.error(`Device not found: ${data.deviceId}`);
      return;
    }

    logger.info(`🎤 Voice command from ${device.name}: ${data.text}`);

    // 记录对话历史
    this.addToHistory(data.deviceId, {
      role: "user",
      content: data.text,
      timestamp: data.timestamp,
      source: "voice",
    });

    // 转发到控制频道
    try {
      await this.sendToChannel({
        channel: this.config.openclaw.controlChannel,
        userId: this.config.openclaw.adminUserId,
        text: `🎤 [${device.name}@${device.location}]\n${data.text}`,
        metadata: {
          source: "baidu-voice",
          deviceId: data.deviceId,
          deviceName: device.name,
          timestamp: data.timestamp,
        },
      });
    } catch (error) {
      logger.error("Failed to route voice command:", error);
    }

    // 检查是否是特殊指令
    await this.handleSpecialCommands(data);
  }

  /**
   * 路由 OpenClaw 消息
   * OpenClaw 频道 -> 语音设备
   */
  async routeMessage(message: any): Promise<void> {
    // 检查消息是否来自控制频道
    if (message.channel !== this.config.openclaw.controlChannel) {
      return;
    }

    // 检查是否是回复语音设备的消息
    const metadata = message.metadata || {};
    if (metadata.replyTo && metadata.replyTo.source === "baidu-voice") {
      const deviceId = metadata.replyTo.deviceId;
      const device = this.deviceManager.getDevice(deviceId);

      if (device && device.online) {
        logger.info(`📱 Routing message to device ${device.name}: ${message.text}`);

        // 发送到设备（通过 AI 处理）
        await this.gateway.sendTextToAI(deviceId, message.text);

        // 记录对话历史
        this.addToHistory(deviceId, {
          role: "assistant",
          content: message.text,
          timestamp: new Date(),
          source: "openclaw",
        });
      }
    }

    // 检查是否是设备控制指令
    await this.handleDeviceControlCommands(message);
  }

  /**
   * 处理 Function Call
   * 百度 Function Call -> OpenClaw MCP Server
   */
  async handleFunctionCall(data: FunctionCallData): Promise<void> {
    const device = this.deviceManager.getDevice(data.deviceId);
    if (!device) {
      logger.error(`Device not found: ${data.deviceId}`);
      return;
    }

    logger.info(`🔧 Function call from ${device.name}: ${data.functionName}`);

    try {
      // 查找 MCP 工具映射
      const toolMapping = this.config.mcpTools[data.functionName];

      if (!toolMapping) {
        logger.warn(`No MCP mapping for function: ${data.functionName}`);
        await this.deviceManager.sendFunctionCallResult(
          data.deviceId,
          data.sessionId,
          false,
          `未找到工具映射: ${data.functionName}`,
        );
        return;
      }

      // 调用 MCP Server
      const result = await this.callMcpTool(toolMapping.server, toolMapping.tool, data.parameters);

      // 返回结果给设备
      await this.deviceManager.sendFunctionCallResult(
        data.deviceId,
        data.sessionId,
        true,
        JSON.stringify(result),
      );

      // 通知管理员
      await this.sendToChannel({
        channel: this.config.openclaw.controlChannel,
        userId: this.config.openclaw.adminUserId,
        text: `✅ [${device.name}] 执行成功: ${data.functionName}\n参数: ${JSON.stringify(data.parameters)}\n结果: ${JSON.stringify(result)}`,
      });

      logger.info(`✅ Function call succeeded: ${data.functionName}`);
    } catch (error: any) {
      logger.error(`Function call failed: ${data.functionName}`, error);

      await this.deviceManager.sendFunctionCallResult(
        data.deviceId,
        data.sessionId,
        false,
        error.message || "执行失败",
      );

      // 通知管理员
      await this.sendToChannel({
        channel: this.config.openclaw.controlChannel,
        userId: this.config.openclaw.adminUserId,
        text: `❌ [${device.name}] 执行失败: ${data.functionName}\n错误: ${error.message}`,
      });
    }
  }

  /**
   * 调用 MCP 工具
   */
  private async callMcpTool(
    server: string,
    tool: string,
    parameters: Record<string, any>,
  ): Promise<any> {
    // 这里需要调用 OpenClaw 的 MCP 接口
    // 实际实现需要根据 OpenClaw 的 API 来调整
    logger.info(`Calling MCP tool: ${server}/${tool}`);

    // 示例实现（需要替换为实际的 MCP 调用）
    const response = await fetch(`${this.config.openclaw.gatewayUrl}/api/mcp/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server,
        tool,
        parameters,
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP call failed: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * 处理特殊指令
   */
  private async handleSpecialCommands(data: VoiceCommandData): Promise<void> {
    const text = data.text.toLowerCase();

    // 设备状态查询
    if (text.includes("设备状态") || text.includes("device status")) {
      const status = await this.deviceManager.getStatus();
      const statusText = this.formatDeviceStatus(status);
      await this.deviceManager.sendTtsMessage(data.deviceId, statusText);
    }

    // 广播消息
    else if (text.startsWith("广播:") || text.startsWith("broadcast:")) {
      const message = text.replace(/^(广播:|broadcast:)/i, "").trim();
      await this.deviceManager.broadcastTtsMessage(message);
    }

    // 查询对话历史
    else if (text.includes("对话历史") || text.includes("conversation history")) {
      const history = this.getHistory(data.deviceId, 5);
      const historyText = this.formatHistory(history);
      await this.deviceManager.sendTtsMessage(data.deviceId, historyText);
    }
  }

  /**
   * 处理设备控制指令
   */
  private async handleDeviceControlCommands(message: any): Promise<void> {
    const text = message.text.toLowerCase();

    // 重启设备
    if (text.startsWith("/baidu-reconnect")) {
      const parts = text.split(" ");
      const deviceId = parts[1];
      if (deviceId) {
        await this.deviceManager.reconnectDevice(deviceId);
      }
    }

    // 发送语音消息
    else if (text.startsWith("/baidu-tts") || text.startsWith("/baidu-speak")) {
      const match = text.match(/\/baidu-(?:tts|speak)\s+(\S+)\s+(.+)/);
      if (match) {
        const [, deviceId, voiceText] = match;
        await this.deviceManager.sendTtsMessage(deviceId, voiceText);
      }
    }

    // 打断设备
    else if (text.startsWith("/baidu-interrupt")) {
      const parts = text.split(" ");
      const deviceId = parts[1];
      if (deviceId) {
        await this.deviceManager.interruptDevice(deviceId);
      }
    }
  }

  /**
   * 发送消息到 OpenClaw 频道
   */
  private async sendToChannel(message: {
    channel: string;
    userId: string;
    text: string;
    metadata?: any;
  }): Promise<void> {
    // 这里需要调用 OpenClaw 的消息发送接口
    // 实际实现需要根据 OpenClaw 的 API 来调整
    logger.debug(`Sending to channel ${message.channel}: ${message.text}`);

    // 示例实现（需要替换为实际的 OpenClaw API 调用）
    await fetch(`${this.config.openclaw.gatewayUrl}/api/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  }

  /**
   * 对话历史管理
   */
  private addToHistory(deviceId: string, entry: any): void {
    if (!this.conversationHistory.has(deviceId)) {
      this.conversationHistory.set(deviceId, []);
    }

    const history = this.conversationHistory.get(deviceId)!;
    history.push(entry);

    // 保留最近 100 条
    if (history.length > 100) {
      history.shift();
    }
  }

  private getHistory(deviceId: string, limit = 10): any[] {
    const history = this.conversationHistory.get(deviceId) || [];
    return history.slice(-limit);
  }

  private formatHistory(history: any[]): string {
    if (history.length === 0) {
      return "暂无对话历史";
    }

    const lines = ["最近对话:"];
    for (const entry of history) {
      const role = entry.role === "user" ? "👤" : "🤖";
      lines.push(`${role} ${entry.content}`);
    }

    return lines.join("\n");
  }

  private formatDeviceStatus(status: any): string {
    return `当前有 ${status.onlineDevices} 个设备在线，共 ${status.totalDevices} 个设备。今日消息 ${status.todayMessages} 条。`;
  }
}
