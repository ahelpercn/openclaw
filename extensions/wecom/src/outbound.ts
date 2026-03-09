import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getWecomRuntime } from "./runtime.js";
import { sendMessageWecom } from "./send.js";

export const wecomOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getWecomRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 2048,
  sendText: async ({ to, text, accountId }) => {
    const result = await sendMessageWecom(to, text, {
      accountId: accountId ?? undefined,
    });
    return { channel: "wecom", ...result };
  },
  sendMedia: async ({ to, text, mediaUrl, accountId }) => {
    const combined = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
    const result = await sendMessageWecom(to, combined, {
      accountId: accountId ?? undefined,
    });
    return { channel: "wecom", ...result };
  },
};
