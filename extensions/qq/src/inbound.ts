import {
  GROUP_POLICY_BLOCKED_LABEL,
  createNormalizedOutboundDeliverer,
  createReplyPrefixOptions,
  formatTextWithAttachmentLinks,
  logInboundDrop,
  resolveControlCommandGate,
  resolveOutboundMediaUrls,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
  type OutboundReplyPayload,
  type OpenClawConfig,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import type { ResolvedQqAccount } from "./accounts.js";
import { normalizeQqAllowlist, resolveQqAllowlistMatch } from "./normalize.js";
import {
  resolveQqMentionGate,
  resolveQqGroupAccessGate,
  resolveQqGroupMatch,
  resolveQqGroupSenderAllowed,
  resolveQqRequireMention,
} from "./policy.js";
import { getQqRuntime } from "./runtime.js";
import { sendMessageQq } from "./send.js";
import type { CoreConfig, QqInboundMessage } from "./types.js";

const CHANNEL_ID = "qq" as const;

function resolveQqEffectiveAllowlists(params: {
  configAllowFrom: string[];
  configGroupAllowFrom: string[];
  storeAllowList: string[];
}): {
  effectiveAllowFrom: string[];
  effectiveGroupAllowFrom: string[];
} {
  const effectiveAllowFrom = [...params.configAllowFrom, ...params.storeAllowList].filter(Boolean);
  // Pairing-store entries are DM approvals; do not widen group sender authorization
  const effectiveGroupAllowFrom = [...params.configGroupAllowFrom].filter(Boolean);
  return { effectiveAllowFrom, effectiveGroupAllowFrom };
}

async function deliverQqReply(params: {
  payload: OutboundReplyPayload;
  target: string;
  isGroup: boolean;
  accountId: string;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}) {
  const combined = formatTextWithAttachmentLinks(
    params.payload.text,
    resolveOutboundMediaUrls(params.payload),
  );
  if (!combined) {
    return;
  }

  await sendMessageQq(params.target, combined, {
    accountId: params.accountId,
    isGroup: params.isGroup,
  });
  params.statusSink?.({ lastOutboundAt: Date.now() });
}

export async function handleQqInbound(params: {
  message: QqInboundMessage;
  account: ResolvedQqAccount;
  config: CoreConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, statusSink } = params;
  const core = getQqRuntime();

  const rawBody = message.text?.trim() ?? "";
  if (!rawBody) {
    return;
  }

  statusSink?.({ lastInboundAt: message.timestamp });

  const senderDisplay = message.senderNickname
    ? `${message.senderNickname}(${message.senderId})`
    : message.senderId;

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const defaultGroupPolicy = resolveDefaultGroupPolicy(config);
  const { groupPolicy, providerMissingFallbackApplied } =
    resolveAllowlistProviderRuntimeGroupPolicy({
      providerConfigPresent: config.channels?.qq !== undefined,
      groupPolicy: account.config.groupPolicy,
      defaultGroupPolicy,
    });
  warnMissingProviderGroupPolicyFallbackOnce({
    providerMissingFallbackApplied,
    providerKey: "qq",
    accountId: account.accountId,
    blockedLabel: GROUP_POLICY_BLOCKED_LABEL.channel,
    log: (msg) => runtime.log?.(msg),
  });

  const configAllowFrom = normalizeQqAllowlist(account.config.allowFrom);
  const configGroupAllowFrom = normalizeQqAllowlist(account.config.groupAllowFrom);
  const storeAllowFrom =
    dmPolicy === "allowlist"
      ? []
      : await core.channel.pairing.readAllowFromStore(CHANNEL_ID).catch(() => []);
  const storeAllowList = normalizeQqAllowlist(storeAllowFrom);

  const groupMatch = resolveQqGroupMatch({
    groups: account.config.groups,
    target: message.target,
  });

  // Group access gate
  if (message.isGroup) {
    const groupAccess = resolveQqGroupAccessGate({ groupPolicy, groupMatch });
    if (!groupAccess.allowed) {
      runtime.log?.(`qq: drop group ${message.target} (${groupAccess.reason})`);
      return;
    }
  }

  const directGroupAllowFrom = normalizeQqAllowlist(groupMatch.groupConfig?.allowFrom);
  const wildcardGroupAllowFrom = normalizeQqAllowlist(groupMatch.wildcardConfig?.allowFrom);
  const groupAllowFrom =
    directGroupAllowFrom.length > 0 ? directGroupAllowFrom : wildcardGroupAllowFrom;

  const { effectiveAllowFrom, effectiveGroupAllowFrom } = resolveQqEffectiveAllowlists({
    configAllowFrom,
    configGroupAllowFrom,
    storeAllowList,
  });

  // Control command gate
  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config as OpenClawConfig,
    surface: CHANNEL_ID,
  });
  const useAccessGroups = config.commands?.useAccessGroups !== false;
  const senderAllowedForCommands = resolveQqAllowlistMatch({
    allowFrom: message.isGroup ? effectiveGroupAllowFrom : effectiveAllowFrom,
    message,
  }).allowed;
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config as OpenClawConfig);
  const commandGate = resolveControlCommandGate({
    useAccessGroups,
    authorizers: [
      {
        configured: (message.isGroup ? effectiveGroupAllowFrom : effectiveAllowFrom).length > 0,
        allowed: senderAllowedForCommands,
      },
    ],
    allowTextCommands,
    hasControlCommand,
  });
  const commandAuthorized = commandGate.commandAuthorized;

  // Group sender gate
  if (message.isGroup) {
    const senderAllowed = resolveQqGroupSenderAllowed({
      groupPolicy,
      message,
      outerAllowFrom: effectiveGroupAllowFrom,
      innerAllowFrom: groupAllowFrom,
    });
    if (!senderAllowed) {
      runtime.log?.(`qq: drop group sender ${senderDisplay} (policy=${groupPolicy})`);
      return;
    }
  } else {
    // DM policy enforcement
    if (dmPolicy === "disabled") {
      runtime.log?.(`qq: drop DM sender=${senderDisplay} (dmPolicy=disabled)`);
      return;
    }
    if (dmPolicy !== "open") {
      const dmAllowed = resolveQqAllowlistMatch({
        allowFrom: effectiveAllowFrom,
        message,
      }).allowed;
      if (!dmAllowed) {
        if (dmPolicy === "pairing") {
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: CHANNEL_ID,
            id: message.senderId,
            meta: { name: message.senderNickname || undefined },
          });
          if (created) {
            try {
              const reply = core.channel.pairing.buildPairingReply({
                channel: CHANNEL_ID,
                idLine: `Your QQ id: ${message.senderId}`,
                code,
              });
              await deliverQqReply({
                payload: { text: reply },
                target: message.senderId,
                isGroup: false,
                accountId: account.accountId,
                statusSink,
              });
            } catch (err) {
              runtime.error?.(`qq: pairing reply failed for ${senderDisplay}: ${String(err)}`);
            }
          }
        }
        runtime.log?.(`qq: drop DM sender ${senderDisplay} (dmPolicy=${dmPolicy})`);
        return;
      }
    }
  }

  if (message.isGroup && commandGate.shouldBlock) {
    logInboundDrop({
      log: (line) => runtime.log?.(line),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: senderDisplay,
    });
    return;
  }

  // Mention gate for groups
  // With the official API, GROUP_AT_MESSAGE_CREATE events inherently mean @bot.
  // So for group messages from that event, wasMentioned is always true.
  const mentionRegexes = core.channel.mentions.buildMentionRegexes(config as OpenClawConfig);
  const wasMentioned =
    message.isGroup || core.channel.mentions.matchesMentionPatterns(rawBody, mentionRegexes);

  const requireMention = message.isGroup
    ? resolveQqRequireMention({
        groupConfig: groupMatch.groupConfig,
        wildcardConfig: groupMatch.wildcardConfig,
      })
    : false;

  const mentionGate = resolveQqMentionGate({
    isGroup: message.isGroup,
    requireMention,
    wasMentioned,
    hasControlCommand,
    allowTextCommands,
    commandAuthorized,
  });
  if (mentionGate.shouldSkip) {
    runtime.log?.(`qq: drop group ${message.target} (${mentionGate.reason})`);
    return;
  }

  // Route to agent
  const peerId = message.isGroup ? message.target : message.senderId;
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: message.isGroup ? "group" : "direct",
      id: peerId,
    },
  });

  const fromLabel = message.isGroup ? `group:${message.target}` : senderDisplay;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config as OpenClawConfig);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "QQ",
    from: fromLabel,
    timestamp: message.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const groupSystemPrompt = groupMatch.groupConfig?.systemPrompt?.trim() || undefined;

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: message.isGroup ? `qq:group:${message.target}` : `qq:${message.senderId}`,
    To: `qq:${peerId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: message.isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: message.senderNickname || undefined,
    SenderId: message.senderId,
    GroupSubject: message.isGroup ? message.target : undefined,
    GroupSystemPrompt: message.isGroup ? groupSystemPrompt : undefined,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    WasMentioned: message.isGroup ? wasMentioned : undefined,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `qq:${peerId}`,
    CommandAuthorized: commandAuthorized,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`qq: failed updating session meta: ${String(err)}`);
    },
  });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config as OpenClawConfig,
    agentId: route.agentId,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });
  const deliverReply = createNormalizedOutboundDeliverer(async (payload) => {
    await deliverQqReply({
      payload,
      target: peerId,
      isGroup: message.isGroup,
      accountId: account.accountId,
      statusSink,
    });
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config as OpenClawConfig,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: deliverReply,
      onError: (err, info) => {
        runtime.error?.(`qq ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: {
      skillFilter: groupMatch.groupConfig?.skills,
      onModelSelected,
      disableBlockStreaming:
        typeof account.config.blockStreaming === "boolean"
          ? !account.config.blockStreaming
          : undefined,
    },
  });
}
