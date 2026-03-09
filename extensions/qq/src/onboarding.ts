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
import { listQqAccountIds, resolveDefaultQqAccountId, resolveQqAccount } from "./accounts.js";
import { normalizeQqAllowEntry } from "./normalize.js";
import type { CoreConfig, QqAccountConfig } from "./types.js";

const channel = "qq" as const;

function updateQqAccountConfig(
  cfg: CoreConfig,
  accountId: string,
  patch: Partial<QqAccountConfig>,
): CoreConfig {
  const current = cfg.channels?.qq ?? {};
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        qq: { ...current, ...patch },
      },
    };
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      qq: {
        ...current,
        accounts: {
          ...current.accounts,
          [accountId]: { ...current.accounts?.[accountId], ...patch },
        },
      },
    },
  };
}

function setQqDmPolicy(cfg: CoreConfig, dmPolicy: DmPolicy): CoreConfig {
  const allowFrom =
    dmPolicy === "open" ? addWildcardAllowFrom(cfg.channels?.qq?.allowFrom) : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      qq: {
        ...cfg.channels?.qq,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

function setQqGroupAccess(
  cfg: CoreConfig,
  accountId: string,
  policy: "open" | "allowlist" | "disabled",
  entries: string[],
): CoreConfig {
  if (policy !== "allowlist") {
    return updateQqAccountConfig(cfg, accountId, { enabled: true, groupPolicy: policy });
  }
  const groups = Object.fromEntries(entries.filter(Boolean).map((entry) => [entry, {}]));
  return updateQqAccountConfig(cfg, accountId, {
    enabled: true,
    groupPolicy: "allowlist",
    groups,
  });
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "QQ",
  channel,
  policyKey: "channels.qq.dmPolicy",
  allowFromKey: "channels.qq.allowFrom",
  getCurrent: (cfg) => (cfg as CoreConfig).channels?.qq?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setQqDmPolicy(cfg as CoreConfig, policy),
};

export const qqOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const coreCfg = cfg as CoreConfig;
    const configured = listQqAccountIds(coreCfg).some(
      (accountId) => resolveQqAccount({ cfg: coreCfg, accountId }).configured,
    );
    return {
      channel,
      configured,
      statusLines: [`QQ: ${configured ? "configured" : "needs appId + appSecret"}`],
      selectionHint: configured ? "configured" : "needs appId + appSecret",
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
    const qqOverride = accountOverrides.qq?.trim();
    const defaultAccountId = resolveDefaultQqAccountId(next);
    let accountId = qqOverride || defaultAccountId;
    if (shouldPromptAccountIds && !qqOverride) {
      accountId = await promptAccountId({
        cfg: next,
        prompter,
        label: "QQ",
        currentId: accountId,
        listAccountIds: listQqAccountIds,
        defaultAccountId,
      });
    }

    const resolved = resolveQqAccount({ cfg: next, accountId });
    const isDefaultAccount = accountId === DEFAULT_ACCOUNT_ID;
    const envAppId = isDefaultAccount ? process.env.QQ_APP_ID?.trim() : "";
    const envAppSecret = isDefaultAccount ? process.env.QQ_APP_SECRET?.trim() : "";

    const appId = String(
      await prompter.text({
        message: "QQ Bot AppID (from q.qq.com):",
        initialValue: resolved.appId || envAppId || undefined,
        validate: (value) => {
          if (!String(value ?? "").trim()) {
            return "AppID is required";
          }
          return undefined;
        },
      }),
    ).trim();

    const appSecret = String(
      await prompter.text({
        message: "QQ Bot AppSecret (from q.qq.com):",
        initialValue: envAppSecret || undefined,
        validate: (value) => {
          if (!String(value ?? "").trim()) {
            return "AppSecret is required";
          }
          return undefined;
        },
      }),
    ).trim();

    next = updateQqAccountConfig(next, accountId, {
      enabled: true,
      appId,
      appSecret,
    });

    const afterConfig = resolveQqAccount({ cfg: next, accountId });
    const accessConfig = await promptChannelAccessConfig({
      prompter,
      label: "QQ groups",
      currentPolicy: afterConfig.config.groupPolicy ?? "allowlist",
      currentEntries: Object.keys(afterConfig.config.groups ?? {}),
      placeholder: "123456789, 987654321",
      updatePrompt: Boolean(afterConfig.config.groups),
    });
    if (accessConfig) {
      next = setQqGroupAccess(next, accountId, accessConfig.policy, accessConfig.entries);
    }

    if (forceAllowFrom) {
      const raw = await prompter.text({
        message: "QQ allowFrom (comma-separated QQ numbers):",
        placeholder: "123456789",
      });
      const entries = String(raw)
        .split(/[,;\n]+/)
        .map((e) => normalizeQqAllowEntry(e.trim()))
        .filter(Boolean);
      if (entries.length > 0) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            qq: { ...next.channels?.qq, allowFrom: entries },
          },
        };
      }
    }

    await prompter.note(
      [
        "Next: restart gateway and verify status.",
        "Command: openclaw channels status --probe",
        `Docs: ${formatDocsLink("/channels/qq", "channels/qq")}`,
      ].join("\n"),
      "QQ next steps",
    );

    return { cfg: next, accountId };
  },
  dmPolicy,
  disable: (cfg) => ({
    ...(cfg as CoreConfig),
    channels: {
      ...(cfg as CoreConfig).channels,
      qq: {
        ...(cfg as CoreConfig).channels?.qq,
        enabled: false,
      },
    },
  }),
};
