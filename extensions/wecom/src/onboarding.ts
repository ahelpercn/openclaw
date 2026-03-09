import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  formatDocsLink,
  promptAccountId,
  promptChannelAccessConfig,
  type ChannelOnboardingAdapter,
  type ChannelOnboardingDmPolicy,
  type DmPolicy,
} from "openclaw/plugin-sdk";
import {
  listWecomAccountIds,
  resolveDefaultWecomAccountId,
  resolveWecomAccount,
} from "./accounts.js";
import { normalizeWecomAllowEntry } from "./normalize.js";
import type { CoreConfig, WecomAccountConfig } from "./types.js";

const channel = "wecom" as const;

function updateWecomAccountConfig(
  cfg: CoreConfig,
  accountId: string,
  patch: Partial<WecomAccountConfig>,
): CoreConfig {
  const current = cfg.channels?.wecom ?? {};
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: { ...cfg.channels, wecom: { ...current, ...patch } },
    };
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      wecom: {
        ...current,
        accounts: {
          ...current.accounts,
          [accountId]: { ...current.accounts?.[accountId], ...patch },
        },
      },
    },
  };
}

function setWecomDmPolicy(cfg: CoreConfig, dmPolicy: DmPolicy): CoreConfig {
  const allowFrom =
    dmPolicy === "open" ? addWildcardAllowFrom(cfg.channels?.wecom?.allowFrom) : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      wecom: {
        ...cfg.channels?.wecom,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

function setWecomGroupAccess(
  cfg: CoreConfig,
  accountId: string,
  policy: "open" | "allowlist" | "disabled",
  entries: string[],
): CoreConfig {
  if (policy !== "allowlist") {
    return updateWecomAccountConfig(cfg, accountId, { enabled: true, groupPolicy: policy });
  }
  const groups = Object.fromEntries(entries.filter(Boolean).map((entry) => [entry, {}]));
  return updateWecomAccountConfig(cfg, accountId, {
    enabled: true,
    groupPolicy: "allowlist",
    groups,
  });
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "WeCom",
  channel,
  policyKey: "channels.wecom.dmPolicy",
  allowFromKey: "channels.wecom.allowFrom",
  getCurrent: (cfg) => (cfg as CoreConfig).channels?.wecom?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setWecomDmPolicy(cfg as CoreConfig, policy),
};

export const wecomOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const coreCfg = cfg as CoreConfig;
    const configured = listWecomAccountIds(coreCfg).some(
      (accountId) => resolveWecomAccount({ cfg: coreCfg, accountId }).configured,
    );
    return {
      channel,
      configured,
      statusLines: [`WeCom: ${configured ? "configured" : "needs corpId + corpSecret + agentId"}`],
      selectionHint: configured ? "configured" : "needs corp credentials",
      quickstartScore: configured ? 1 : 0,
    };
  },
  configure: async ({
    cfg,
    prompter,
    accountOverrides,
    shouldPromptAccountIds,
    forceAllowFrom,
  }) => {
    let next = cfg as CoreConfig;
    const wecomOverride = accountOverrides.wecom?.trim();
    const defaultAccountId = resolveDefaultWecomAccountId(next);
    let accountId = wecomOverride || defaultAccountId;
    if (shouldPromptAccountIds && !wecomOverride) {
      accountId = await promptAccountId({
        cfg: next,
        prompter,
        label: "WeCom",
        currentId: accountId,
        listAccountIds: listWecomAccountIds,
        defaultAccountId,
      });
    }

    const resolved = resolveWecomAccount({ cfg: next, accountId });
    const isDefaultAccount = accountId === DEFAULT_ACCOUNT_ID;
    const envCorpId = isDefaultAccount ? process.env.WECOM_CORP_ID?.trim() : "";
    const envCorpSecret = isDefaultAccount ? process.env.WECOM_CORP_SECRET?.trim() : "";
    const envAgentId = isDefaultAccount ? process.env.WECOM_AGENT_ID?.trim() : "";

    const corpId = String(
      await prompter.text({
        message: "Enterprise Corp ID:",
        initialValue: resolved.corpId || envCorpId || undefined,
        validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
      }),
    ).trim();

    const corpSecret = String(
      await prompter.text({
        message: "App Secret:",
        initialValue: resolved.corpSecret || envCorpSecret || undefined,
        validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
      }),
    ).trim();

    const agentIdStr = String(
      await prompter.text({
        message: "App Agent ID (numeric):",
        initialValue: resolved.agentId?.toString() || envAgentId || undefined,
        validate: (value) => {
          if (!String(value ?? "").trim()) {
            return "Required";
          }
          if (!/^\d+$/.test(String(value).trim())) {
            return "Agent ID must be numeric";
          }
          return undefined;
        },
      }),
    ).trim();

    const token = String(
      await prompter.text({
        message: "Callback Token (optional):",
        initialValue: resolved.token || undefined,
      }),
    ).trim();

    const encodingAESKey = String(
      await prompter.text({
        message: "Callback EncodingAESKey (optional):",
        initialValue: resolved.encodingAESKey || undefined,
      }),
    ).trim();

    next = updateWecomAccountConfig(next, accountId, {
      enabled: true,
      corpId,
      corpSecret,
      agentId: Number.parseInt(agentIdStr, 10),
      ...(token ? { token } : {}),
      ...(encodingAESKey ? { encodingAESKey } : {}),
    });

    const afterConfig = resolveWecomAccount({ cfg: next, accountId });
    const accessConfig = await promptChannelAccessConfig({
      prompter,
      label: "WeCom groups",
      currentPolicy: afterConfig.config.groupPolicy ?? "allowlist",
      currentEntries: Object.keys(afterConfig.config.groups ?? {}),
      updatePrompt: Boolean(afterConfig.config.groups),
    });
    if (accessConfig) {
      next = setWecomGroupAccess(next, accountId, accessConfig.policy, accessConfig.entries);
    }

    if (forceAllowFrom) {
      const raw = await prompter.text({
        message: "WeCom allowFrom (comma-separated user IDs):",
      });
      const entries = String(raw)
        .split(/[,;\n]+/)
        .map((e) => normalizeWecomAllowEntry(e.trim()))
        .filter(Boolean);
      if (entries.length > 0) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            wecom: { ...next.channels?.wecom, allowFrom: entries },
          },
        };
      }
    }

    await prompter.note(
      [
        "Next: set callback URL in WeCom admin, then restart gateway.",
        "Command: openclaw channels status --probe",
        `Docs: ${formatDocsLink("/channels/wecom", "channels/wecom")}`,
      ].join("\n"),
      "WeCom next steps",
    );

    return { cfg: next, accountId };
  },
  dmPolicy,
  disable: (cfg) => ({
    ...(cfg as CoreConfig),
    channels: {
      ...(cfg as CoreConfig).channels,
      wecom: {
        ...(cfg as CoreConfig).channels?.wecom,
        enabled: false,
      },
    },
  }),
};
