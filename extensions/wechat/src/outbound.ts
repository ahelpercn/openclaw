import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getWechatRuntime } from "./runtime.js";
import { sendMessageWechat } from "./send.js";

export const wechatOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getWechatRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ to, text, accountId }) => {
    // Determine if target is a room topic or user ID
    // Room topics are typically non-numeric and may contain Chinese characters
    const isRoom = !/^wxid_/.test(to) && !/^\d+$/.test(to);
    const result = await sendMessageWechat(to, text, {
      accountId: accountId ?? undefined,
      isRoom,
    });
    return { channel: "wechat", ...result };
  },
  sendMedia: async ({ to, text, mediaUrl, accountId }) => {
    const combined = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
    const isRoom = !/^wxid_/.test(to) && !/^\d+$/.test(to);
    const result = await sendMessageWechat(to, combined, {
      accountId: accountId ?? undefined,
      isRoom,
    });
    return { channel: "wechat", ...result };
  },
};
