import { resolveWechatAccount } from "./accounts.js";
import { getWechatBot } from "./send.js";
import type { CoreConfig, WechatProbe } from "./types.js";

/** Probe a WeChat account by checking if the bot is logged in. */
export async function probeWechat(
  cfg: CoreConfig,
  opts?: { accountId?: string; timeoutMs?: number },
): Promise<WechatProbe> {
  const account = resolveWechatAccount({ cfg, accountId: opts?.accountId });
  if (!account.configured) {
    return { ok: false, error: "not configured", puppet: account.puppet };
  }

  const bot = getWechatBot(account.accountId);
  if (!bot) {
    return { ok: false, error: "bot not running", puppet: account.puppet };
  }

  try {
    const wechatyBot = bot as { isLoggedIn: boolean; currentUser?: { name(): string; id: string } };
    if (!wechatyBot.isLoggedIn) {
      return { ok: false, error: "not logged in (scan QR code)", puppet: account.puppet };
    }

    const user = wechatyBot.currentUser;
    return {
      ok: true,
      selfName: user?.name() ?? undefined,
      selfId: user?.id ?? undefined,
      puppet: account.puppet,
    };
  } catch (err) {
    return { ok: false, error: String(err), puppet: account.puppet };
  }
}
