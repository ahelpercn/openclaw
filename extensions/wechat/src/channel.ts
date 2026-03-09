import {
  buildBaseAccountStatusSnapshot,
  buildBaseChannelStatusSummary,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  PAIRING_APPROVED_MESSAGE,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import {
  listWechatAccountIds,
  resolveDefaultWechatAccountId,
  resolveWechatAccount,
  type ResolvedWechatAccount,
} from "./accounts.js";
import { WechatConfigSchema } from "./config-schema.js";
import { monitorWechatProvider } from "./monitor.js";
import {
  normalizeWechatMessagingTarget,
  looksLikeWechatId,
  normalizeWechatAllowEntry,
} from "./normalize.js";
import { wechatOnboardingAdapter } from "./onboarding.js";
import { wechatOutbound } from "./outbound.js";
import { resolveWechatGroupMatch, resolveWechatRequireMention } from "./policy.js";
import { probeWechat } from "./probe.js";
import { getWechatRuntime } from "./runtime.js";
import { sendMessageWechat } from "./send.js";
import type { CoreConfig, WechatProbe } from "./types.js";

const meta = {
  id: "wechat" as const,
  label: "WeChat",
  selectionLabel: "WeChat (Wechaty)",
  docsPath: "/channels/wechat",
  docsLabel: "wechat",
  blurb: "WeChat personal accounts via Wechaty puppet.",
  order: 37,
  quickstartAllowFrom: true,
};

export const wechatPlugin: ChannelPlugin<ResolvedWechatAccount, WechatProbe> = {
  id: "wechat",
  meta,
  onboarding: wechatOnboardingAdapter,
  pairing: {
    idLabel: "wechatId",
    normalizeAllowEntry: (entry) => normalizeWechatAllowEntry(entry),
    notifyApproval: async ({ id }) => {
      const target = normalizeWechatAllowEntry(id);
      if (!target) {
        throw new Error(`invalid WeChat pairing id: ${id}`);
      }
      await sendMessageWechat(target, PAIRING_APPROVED_MESSAGE, { isRoom: false });
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.wechat"] },
  configSchema: buildChannelConfigSchema(WechatConfigSchema),
  config: {
    listAccountIds: (cfg) => listWechatAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) =>
      resolveWechatAccount({ cfg: cfg as CoreConfig, accountId: accountId ?? undefined }),
    defaultAccountId: (cfg) => resolveDefaultWechatAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "wechat",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "wechat",
        accountId,
        clearBaseFields: ["name", "puppet", "puppetOptions"],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      puppet: account.puppet,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (
        resolveWechatAccount({ cfg: cfg as CoreConfig, accountId: accountId ?? undefined }).config
          .allowFrom ?? []
      ).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map((entry) => normalizeWechatAllowEntry(String(entry))).filter(Boolean),
    resolveDefaultTo: ({ cfg, accountId }) =>
      resolveWechatAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      }).config.defaultTo?.trim() || undefined,
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(cfg.channels?.wechat?.accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.wechat.accounts.${resolvedAccountId}.`
        : "channels.wechat.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: `${basePath}allowFrom`,
        approveHint: formatPairingApproveHint("wechat"),
        normalizeEntry: (raw) => normalizeWechatAllowEntry(raw),
      };
    },
    collectWarnings: ({ account, cfg }) => {
      const warnings: string[] = [];
      const defaultGroupPolicy = resolveDefaultGroupPolicy(cfg);
      const { groupPolicy } = resolveAllowlistProviderRuntimeGroupPolicy({
        providerConfigPresent: cfg.channels?.wechat !== undefined,
        groupPolicy: account.config.groupPolicy,
        defaultGroupPolicy,
      });
      if (groupPolicy === "open") {
        warnings.push(
          '- WeChat: groupPolicy="open" allows all rooms (mention-gated). Prefer channels.wechat.groupPolicy="allowlist" with channels.wechat.groups.',
        );
      }
      return warnings;
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId, groupId }) => {
      const account = resolveWechatAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      });
      if (!groupId) {
        return true;
      }
      const match = resolveWechatGroupMatch({
        groups: account.config.groups,
        target: groupId,
      });
      return resolveWechatRequireMention({
        groupConfig: match.groupConfig,
        wildcardConfig: match.wildcardConfig,
      });
    },
    resolveToolPolicy: ({ cfg, accountId, groupId }) => {
      const account = resolveWechatAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      });
      if (!groupId) {
        return undefined;
      }
      const match = resolveWechatGroupMatch({
        groups: account.config.groups,
        target: groupId,
      });
      return match.groupConfig?.tools ?? match.wildcardConfig?.tools;
    },
  },
  messaging: {
    normalizeTarget: normalizeWechatMessagingTarget,
    targetResolver: {
      looksLikeId: looksLikeWechatId,
      hint: "<wechatId|roomTopic>",
    },
  },
  resolver: {
    resolveTargets: async ({ inputs }) => {
      return inputs.map((input) => {
        const normalized = normalizeWechatMessagingTarget(input);
        if (!normalized) {
          return { input, resolved: false, note: "invalid WeChat target" };
        }
        return { input, resolved: true, id: normalized, name: normalized };
      });
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveWechatAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      });
      const q = query?.trim().toLowerCase() ?? "";
      const ids = new Set<string>();
      for (const entry of account.config.allowFrom ?? []) {
        const normalized = normalizeWechatAllowEntry(String(entry));
        if (normalized && normalized !== "*") {
          ids.add(normalized);
        }
      }
      return Array.from(ids)
        .filter((id) => (q ? id.includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "user", id }));
    },
    listGroups: async ({ cfg, accountId, query, limit }) => {
      const account = resolveWechatAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      });
      const q = query?.trim().toLowerCase() ?? "";
      const groupIds = new Set<string>();
      for (const group of Object.keys(account.config.groups ?? {})) {
        if (group === "*") {
          continue;
        }
        groupIds.add(group);
      }
      return Array.from(groupIds)
        .filter((id) => (q ? id.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "group", id, name: id }));
    },
  },
  outbound: wechatOutbound,
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ account, snapshot }) => ({
      ...buildBaseChannelStatusSummary(snapshot),
      puppet: account.puppet,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ cfg, account, timeoutMs }) =>
      probeWechat(cfg as CoreConfig, { accountId: account.accountId, timeoutMs }),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      ...buildBaseAccountStatusSnapshot({ account, runtime, probe }),
      puppet: account.puppet,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.configured) {
        throw new Error(`WeChat is not configured for account "${account.accountId}".`);
      }
      ctx.log?.info(`[${account.accountId}] starting WeChat provider (puppet: ${account.puppet})`);
      const { stop } = await monitorWechatProvider({
        accountId: account.accountId,
        config: ctx.cfg as CoreConfig,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });
      return { stop };
    },
  },
};
