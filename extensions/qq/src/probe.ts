import { resolveQqAccount } from "./accounts.js";
import { getBotInfo } from "./client.js";
import type { CoreConfig, QqProbe } from "./types.js";

/** Probe the QQ Bot API by fetching bot info via /users/@me. */
export async function probeQq(
  cfg: CoreConfig,
  opts?: { accountId?: string; timeoutMs?: number },
): Promise<QqProbe> {
  const account = resolveQqAccount({ cfg, accountId: opts?.accountId });
  if (!account.configured) {
    return { ok: false, error: "not configured (appId + appSecret missing)" };
  }

  const timeout = opts?.timeoutMs ?? 8000;
  const start = Date.now();

  try {
    const result = await Promise.race([
      getBotInfo(account.appId, account.appSecret),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeout)),
    ]);

    return {
      ok: true,
      botId: result.id,
      botName: result.username,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err),
      latencyMs: Date.now() - start,
    };
  }
}
