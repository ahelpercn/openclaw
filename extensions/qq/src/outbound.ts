import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { isGroupTarget, stripGroupPrefix } from "./normalize.js";
import { getQqRuntime } from "./runtime.js";
import { sendMessageQq } from "./send.js";

export const qqOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getQqRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ to, text, accountId }) => {
    // "group:OPENID" → group message, plain openid → C2C
    const isGroup = isGroupTarget(to);
    const target = stripGroupPrefix(to);
    const result = await sendMessageQq(target, text, {
      accountId: accountId ?? undefined,
      isGroup,
    });
    return { channel: "qq", ...result };
  },
  sendMedia: async ({ to, text, mediaUrl, accountId }) => {
    const combined = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
    const isGroup = isGroupTarget(to);
    const target = stripGroupPrefix(to);
    const result = await sendMessageQq(target, combined, {
      accountId: accountId ?? undefined,
      isGroup,
    });
    return { channel: "qq", ...result };
  },
};
