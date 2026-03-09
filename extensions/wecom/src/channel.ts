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
  listWecomAccountIds,
  resolveDefaultWecomAccountId,
  resolveWecomAccount,
  type ResolvedWecomAccount,
} from "./accounts.js";
import { WecomConfigSchema } from "./config-schema.js";
import { monitorWecomProvider } from "./monitor.js";
import {
  normalizeWecomMessagingTarget,
  looksLikeWecomId,
  normalizeWecomAllowEntry,
} from "./normalize.js";
import { wecomOnboardingAdapter } from "./onboarding.js";
import { wecomOutbound } from "./outbound.js";
import { resolveWecomGroupMatch, resolveWecomRequireMention } from "./policy.js";
import { probeWecom } from "./probe.js";
import { getWecomRuntime } from "./runtime.js";
import { sendMessageWecom } from "./send.js";
import type { CoreConfig, WecomProbe } from "./types.js";

const meta = {
  id: "wecom" as const,
  label: "WeCom",
  selectionLabel: "WeCom (企业微信)",
  docsPath: "/channels/wecom",
  docsLabel: "wecom",
  blurb: "企业微信 (Enterprise WeChat) via official API.",
  aliases: ["wxwork"] as string[],
  order: 36,
  quickstartAllowFrom: true,
};

export const wecomPlugin: ChannelPlugin<ResolvedWecomAccount, WecomProbe> = {
  id: "wecom",
  meta,
  onboarding: wecomOnboardingAdapter,
  pairing: {
    idLabel: "wecomUserId",
    normalizeAllowEntry: (entry) => normalizeWecomAllowEntry(entry),
    notifyApproval: async ({ id }) => {
      const target = normalizeWecomAllowEntry(id);
      if (!target) {
        throw new Error(`invalid WeCom pairing id: ${id}`);
      }
      await sendMessageWecom(target, PAIRING_APPROVED_MESSAGE);
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.wecom"] },
  configSchema: buildChannelConfigSchema(WecomConfigSchema),
  config: {
    listAccountIds: (cfg) => listWecomAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) =>
      resolveWecomAccount({ cfg: cfg as CoreConfig, accountId: accountId ?? undefined }),
    defaultAccountId: (cfg) => resolveDefaultWecomAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "wecom",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "wecom",
        accountId,
        clearBaseFields: [
          "name",
          "corpId",
          "corpSecret",
          "agentId",
          "token",
          "encodingAESKey",
          "webhookPath",
        ],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      corpId: account.corpId,
      agentId: account.agentId,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (
        resolveWecomAccount({ cfg: cfg as CoreConfig, accountId: accountId ?? undefined }).config
          .allowFrom ?? []
      ).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map((entry) => normalizeWecomAllowEntry(String(entry))).filter(Boolean),
    resolveDefaultTo: ({ cfg, accountId }) =>
      resolveWecomAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      }).config.defaultTo?.trim() || undefined,
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(cfg.channels?.wecom?.accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.wecom.accounts.${resolvedAccountId}.`
        : "channels.wecom.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: `${basePath}allowFrom`,
        approveHint: formatPairingApproveHint("wecom"),
        normalizeEntry: (raw) => normalizeWecomAllowEntry(raw),
      };
    },
    collectWarnings: ({ account, cfg }) => {
      const warnings: string[] = [];
      const defaultGroupPolicy = resolveDefaultGroupPolicy(cfg);
      const { groupPolicy } = resolveAllowlistProviderRuntimeGroupPolicy({
        providerConfigPresent: cfg.channels?.wecom !== undefined,
        groupPolicy: account.config.groupPolicy,
        defaultGroupPolicy,
      });
      if (groupPolicy === "open") {
        warnings.push(
          '- WeCom: groupPolicy="open" allows all groups (mention-gated). Prefer channels.wecom.groupPolicy="allowlist" with channels.wecom.groups.',
        );
      }
      if (!account.token || !account.encodingAESKey) {
        warnings.push(
          "- WeCom callback encryption not fully configured (token/encodingAESKey missing); message verification will be skipped.",
        );
      }
      return warnings;
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId, groupId }) => {
      const account = resolveWecomAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      });
      if (!groupId) {
        return true;
      }
      const match = resolveWecomGroupMatch({
        groups: account.config.groups,
        target: groupId,
      });
      return resolveWecomRequireMention({
        groupConfig: match.groupConfig,
        wildcardConfig: match.wildcardConfig,
      });
    },
    resolveToolPolicy: ({ cfg, accountId, groupId }) => {
      const account = resolveWecomAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      });
      if (!groupId) {
        return undefined;
      }
      const match = resolveWecomGroupMatch({
        groups: account.config.groups,
        target: groupId,
      });
      return match.groupConfig?.tools ?? match.wildcardConfig?.tools;
    },
  },
  messaging: {
    normalizeTarget: normalizeWecomMessagingTarget,
    targetResolver: {
      looksLikeId: looksLikeWecomId,
      hint: "<wecomUserId>",
    },
  },
  resolver: {
    resolveTargets: async ({ inputs }) => {
      return inputs.map((input) => {
        const normalized = normalizeWecomMessagingTarget(input);
        if (!normalized) {
          return { input, resolved: false, note: "invalid WeCom target" };
        }
        return { input, resolved: true, id: normalized, name: normalized };
      });
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveWecomAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      });
      const q = query?.trim().toLowerCase() ?? "";
      const ids = new Set<string>();
      for (const entry of account.config.allowFrom ?? []) {
        const normalized = normalizeWecomAllowEntry(String(entry));
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
      const account = resolveWecomAccount({
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
        .filter((id) => (q ? id.includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "group", id, name: id }));
    },
  },
  outbound: wecomOutbound,
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
      corpId: account.corpId,
      agentId: account.agentId,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ cfg, account, timeoutMs }) =>
      probeWecom(cfg as CoreConfig, { accountId: account.accountId, timeoutMs }),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      ...buildBaseAccountStatusSnapshot({ account, runtime, probe }),
      corpId: account.corpId,
      agentId: account.agentId,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.configured) {
        throw new Error(
          `WeCom is not configured for account "${account.accountId}" (need corpId, corpSecret, agentId).`,
        );
      }
      ctx.log?.info(`[${account.accountId}] starting WeCom provider (corpId=${account.corpId})`);
      const { stop } = await monitorWecomProvider({
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
