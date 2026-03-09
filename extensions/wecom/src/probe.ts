import { resolveWecomAccount } from "./accounts.js";
import { getWecomAgentInfo } from "./client.js";
import type { CoreConfig, WecomProbe } from "./types.js";

/** Probe a WeCom account by fetching agent info. */
export async function probeWecom(
  cfg: CoreConfig,
  opts?: { accountId?: string; timeoutMs?: number },
): Promise<WecomProbe> {
  const account = resolveWecomAccount({ cfg, accountId: opts?.accountId });
  if (!account.configured) {
    return { ok: false, error: "not configured (corpId/corpSecret/agentId missing)" };
  }

  const start = Date.now();
  try {
    const info = await getWecomAgentInfo({
      corpId: account.corpId,
      corpSecret: account.corpSecret,
      agentId: account.agentId,
    });
    if (info.errcode !== 0) {
      return {
        ok: false,
        error: `${info.errcode} ${info.errmsg}`,
        corpId: account.corpId,
      };
    }
    return {
      ok: true,
      corpId: account.corpId,
      agentName: info.name,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return { ok: false, error: String(err), corpId: account.corpId };
  }
}
