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
  listQqAccountIds,
  resolveDefaultQqAccountId,
  resolveQqAccount,
  type ResolvedQqAccount,
} from "./accounts.js";
import { QqConfigSchema } from "./config-schema.js";
import { monitorQqProvider } from "./monitor.js";
import { normalizeQqMessagingTarget, looksLikeQqId, normalizeQqAllowEntry } from "./normalize.js";
import { qqOnboardingAdapter } from "./onboarding.js";
import { qqOutbound } from "./outbound.js";
import { resolveQqGroupMatch, resolveQqRequireMention } from "./policy.js";
import { probeQq } from "./probe.js";
import { sendMessageQq } from "./send.js";
import type { CoreConfig, QqProbe } from "./types.js";

const meta = {
  id: "qq" as const,
  label: "QQ",
  selectionLabel: "QQ (Official Bot API)",
  docsPath: "/channels/qq",
  docsLabel: "qq",
  blurb: "QQ messaging via Official QQ Bot API (groups, channels, DMs).",
  order: 75,
  quickstartAllowFrom: true,
};

export const qqPlugin: ChannelPlugin<ResolvedQqAccount, QqProbe> = {
  id: "qq",
  meta,
  onboarding: qqOnboardingAdapter,
  pairing: {
    idLabel: "qqOpenId",
    normalizeAllowEntry: (entry) => normalizeQqAllowEntry(entry),
    notifyApproval: async ({ id }) => {
      const target = normalizeQqAllowEntry(id);
      if (!target) {
        throw new Error(`invalid QQ pairing id: ${id}`);
      }
      await sendMessageQq(target, PAIRING_APPROVED_MESSAGE, { isGroup: false });
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.qq"] },
  configSchema: buildChannelConfigSchema(QqConfigSchema),
  config: {
    listAccountIds: (cfg) => listQqAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) =>
      resolveQqAccount({ cfg: cfg as CoreConfig, accountId: accountId ?? undefined }),
    defaultAccountId: (cfg) => resolveDefaultQqAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "qq",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "qq",
        accountId,
        clearBaseFields: ["name", "appId", "appSecret"],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      appId: account.appId,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (
        resolveQqAccount({ cfg: cfg as CoreConfig, accountId: accountId ?? undefined }).config
          .allowFrom ?? []
      ).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map((entry) => normalizeQqAllowEntry(String(entry))).filter(Boolean),
    resolveDefaultTo: ({ cfg, accountId }) =>
      resolveQqAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      }).config.defaultTo?.trim() || undefined,
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(cfg.channels?.qq?.accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.qq.accounts.${resolvedAccountId}.`
        : "channels.qq.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: `${basePath}allowFrom`,
        approveHint: formatPairingApproveHint("qq"),
        normalizeEntry: (raw) => normalizeQqAllowEntry(raw),
      };
    },
    collectWarnings: ({ account, cfg }) => {
      const warnings: string[] = [];
      const defaultGroupPolicy = resolveDefaultGroupPolicy(cfg);
      const { groupPolicy } = resolveAllowlistProviderRuntimeGroupPolicy({
        providerConfigPresent: cfg.channels?.qq !== undefined,
        groupPolicy: account.config.groupPolicy,
        defaultGroupPolicy,
      });
      if (groupPolicy === "open") {
        warnings.push(
          '- QQ groups: groupPolicy="open" allows all groups and senders (mention-gated). Prefer channels.qq.groupPolicy="allowlist" with channels.qq.groups.',
        );
      }
      return warnings;
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId, groupId }) => {
      const account = resolveQqAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      });
      if (!groupId) {
        return true;
      }
      const match = resolveQqGroupMatch({ groups: account.config.groups, target: groupId });
      return resolveQqRequireMention({
        groupConfig: match.groupConfig,
        wildcardConfig: match.wildcardConfig,
      });
    },
    resolveToolPolicy: ({ cfg, accountId, groupId }) => {
      const account = resolveQqAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      });
      if (!groupId) {
        return undefined;
      }
      const match = resolveQqGroupMatch({ groups: account.config.groups, target: groupId });
      return match.groupConfig?.tools ?? match.wildcardConfig?.tools;
    },
  },
  messaging: {
    normalizeTarget: normalizeQqMessagingTarget,
    targetResolver: {
      looksLikeId: looksLikeQqId,
      hint: "<openid>",
    },
  },
  resolver: {
    resolveTargets: async ({ inputs, kind }) => {
      return inputs.map((input) => {
        const normalized = normalizeQqMessagingTarget(input);
        if (!normalized) {
          return { input, resolved: false, note: "invalid QQ target" };
        }
        return { input, resolved: true, id: normalized, name: normalized };
      });
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveQqAccount({
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
      });
      const q = query?.trim().toLowerCase() ?? "";
      const ids = new Set<string>();
      for (const entry of account.config.allowFrom ?? []) {
        const normalized = normalizeQqAllowEntry(String(entry));
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
      const account = resolveQqAccount({
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
  outbound: qqOutbound,
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
      appId: account.appId,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ cfg, account, timeoutMs }) =>
      probeQq(cfg as CoreConfig, { accountId: account.accountId, timeoutMs }),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      ...buildBaseAccountStatusSnapshot({ account, runtime, probe }),
      appId: account.appId,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.configured) {
        throw new Error(
          `QQ is not configured for account "${account.accountId}" (need appId + appSecret in channels.qq).`,
        );
      }
      ctx.log?.info(`[${account.accountId}] starting QQ provider (appId=${account.appId})`);
      const { stop } = await monitorQqProvider({
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
