import { resolveQqAccount } from "./accounts.js";
import { sendC2CMessage, sendGroupMessage } from "./client.js";
import { getQqRuntime } from "./runtime.js";
import type { CoreConfig } from "./types.js";

/** Send a message to a QQ user or group via Official Bot API. */
export async function sendMessageQq(
  to: string,
  text: string,
  opts?: {
    accountId?: string;
    isGroup?: boolean;
    /** Original message ID for passive reply (required within reply time window). */
    msgId?: string;
    msgSeq?: number;
  },
): Promise<{ messageId: string; target: string }> {
  const runtime = getQqRuntime();
  const cfg = runtime.config.loadConfig() as CoreConfig;
  const account = resolveQqAccount({ cfg, accountId: opts?.accountId });

  if (!account.configured) {
    throw new Error(`QQ is not configured for account "${account.accountId}"`);
  }

  const isGroup = opts?.isGroup ?? false;

  if (isGroup) {
    const result = await sendGroupMessage({
      appId: account.appId,
      appSecret: account.appSecret,
      groupOpenid: to,
      content: text,
      msgId: opts?.msgId,
      msgSeq: opts?.msgSeq,
    });
    runtime.channel.activity.record({
      channel: "qq",
      accountId: account.accountId,
      direction: "outbound",
    });
    return { messageId: result.id, target: to };
  }

  const result = await sendC2CMessage({
    appId: account.appId,
    appSecret: account.appSecret,
    openid: to,
    content: text,
    msgId: opts?.msgId,
    msgSeq: opts?.msgSeq,
  });
  runtime.channel.activity.record({
    channel: "qq",
    accountId: account.accountId,
    direction: "outbound",
  });
  return { messageId: result.id, target: to };
}
