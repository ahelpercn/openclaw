import { resolveWecomAccount } from "./accounts.js";
import { sendWecomText } from "./client.js";
import { getWecomRuntime } from "./runtime.js";
import type { CoreConfig } from "./types.js";

/** Send a text message via WeCom API. */
export async function sendMessageWecom(
  to: string,
  text: string,
  opts?: { accountId?: string },
): Promise<{ messageId: string; target: string }> {
  const runtime = getWecomRuntime();
  const cfg = runtime.config.loadConfig() as CoreConfig;
  const account = resolveWecomAccount({ cfg, accountId: opts?.accountId });

  if (!account.configured) {
    throw new Error(`WeCom not configured for account "${account.accountId}"`);
  }

  const result = await sendWecomText({
    corpId: account.corpId,
    corpSecret: account.corpSecret,
    agentId: account.agentId,
    toUser: to,
    content: text,
  });

  if (result.errcode !== 0) {
    throw new Error(`WeCom send error: ${result.errcode} ${result.errmsg}`);
  }

  runtime.channel.activity.record({
    channel: "wecom",
    accountId: account.accountId,
    direction: "outbound",
  });

  return { messageId: `wecom_${Date.now()}`, target: to };
}
