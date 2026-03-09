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
  listWechatAccountIds,
  resolveDefaultWechatAccountId,
  resolveWechatAccount,
} from "./accounts.js";
import { normalizeWechatAllowEntry } from "./normalize.js";
import type { CoreConfig, WechatAccountConfig } from "./types.js";

const channel = "wechat" as const;

function updateWechatAccountConfig(
  cfg: CoreConfig,
  accountId: string,
  patch: Partial<WechatAccountConfig>,
): CoreConfig {
  const current = cfg.channels?.wechat ?? {};
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: { ...cfg.channels, wechat: { ...current, ...patch } },
    };
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      wechat: {
        ...current,
        accounts: {
          ...current.accounts,
          [accountId]: { ...current.accounts?.[accountId], ...patch },
        },
      },
    },
  };
}

function setWechatDmPolicy(cfg: CoreConfig, dmPolicy: DmPolicy): CoreConfig {
  const allowFrom =
    dmPolicy === "open" ? addWildcardAllowFrom(cfg.channels?.wechat?.allowFrom) : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      wechat: {
        ...cfg.channels?.wechat,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

function setWechatGroupAccess(
  cfg: CoreConfig,
  accountId: string,
  policy: "open" | "allowlist" | "disabled",
  entries: string[],
): CoreConfig {
  if (policy !== "allowlist") {
    return updateWechatAccountConfig(cfg, accountId, { enabled: true, groupPolicy: policy });
  }
  const groups = Object.fromEntries(entries.filter(Boolean).map((entry) => [entry, {}]));
  return updateWechatAccountConfig(cfg, accountId, {
    enabled: true,
    groupPolicy: "allowlist",
    groups,
  });
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "WeChat",
  channel,
  policyKey: "channels.wechat.dmPolicy",
  allowFromKey: "channels.wechat.allowFrom",
  getCurrent: (cfg) => (cfg as CoreConfig).channels?.wechat?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setWechatDmPolicy(cfg as CoreConfig, policy),
};

export const wechatOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const coreCfg = cfg as CoreConfig;
    const configured = coreCfg.channels?.wechat !== undefined;
    return {
      channel,
      configured,
      statusLines: [`WeChat: ${configured ? "configured" : "needs setup"}`],
      selectionHint: configured ? "configured" : "needs QR scan",
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
    const wechatOverride = accountOverrides.wechat?.trim();
    const defaultAccountId = resolveDefaultWechatAccountId(next);
    let accountId = wechatOverride || defaultAccountId;
    if (shouldPromptAccountIds && !wechatOverride) {
      accountId = await promptAccountId({
        cfg: next,
        prompter,
        label: "WeChat",
        currentId: accountId,
        listAccountIds: listWechatAccountIds,
        defaultAccountId,
      });
    }

    const resolved = resolveWechatAccount({ cfg: next, accountId });

    const puppet = String(
      await prompter.text({
        message: "Wechaty puppet (press Enter for default wechaty-puppet-wechat4):",
        placeholder: "wechaty-puppet-wechat4",
        initialValue: resolved.puppet || "wechaty-puppet-wechat4",
      }),
    ).trim();

    next = updateWechatAccountConfig(next, accountId, {
      enabled: true,
      ...(puppet && puppet !== "wechaty-puppet-wechat4" ? { puppet } : {}),
    });

    // Ensure the wechat section exists
    if (!next.channels?.wechat) {
      next = {
        ...next,
        channels: { ...next.channels, wechat: { enabled: true } },
      };
    }

    const afterConfig = resolveWechatAccount({ cfg: next, accountId });
    const accessConfig = await promptChannelAccessConfig({
      prompter,
      label: "WeChat groups",
      currentPolicy: afterConfig.config.groupPolicy ?? "allowlist",
      currentEntries: Object.keys(afterConfig.config.groups ?? {}),
      updatePrompt: Boolean(afterConfig.config.groups),
    });
    if (accessConfig) {
      next = setWechatGroupAccess(next, accountId, accessConfig.policy, accessConfig.entries);
    }

    if (forceAllowFrom) {
      const raw = await prompter.text({
        message: "WeChat allowFrom (comma-separated WeChat IDs):",
      });
      const entries = String(raw)
        .split(/[,;\n]+/)
        .map((e) => normalizeWechatAllowEntry(e.trim()))
        .filter(Boolean);
      if (entries.length > 0) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            wechat: { ...next.channels?.wechat, allowFrom: entries },
          },
        };
      }
    }

    await prompter.note(
      [
        "Next: restart gateway and scan QR code with WeChat.",
        "Command: openclaw channels status --probe",
        `Docs: ${formatDocsLink("/channels/wechat", "channels/wechat")}`,
      ].join("\n"),
      "WeChat next steps",
    );

    return { cfg: next, accountId };
  },
  dmPolicy,
  disable: (cfg) => ({
    ...(cfg as CoreConfig),
    channels: {
      ...(cfg as CoreConfig).channels,
      wechat: {
        ...(cfg as CoreConfig).channels?.wechat,
        enabled: false,
      },
    },
  }),
};
