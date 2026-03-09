import { normalizeWechatAllowlist, resolveWechatAllowlistMatch } from "./normalize.js";
import type { WechatAccountConfig, WechatGroupConfig, WechatInboundMessage } from "./types.js";

export type WechatGroupMatch = {
  allowed: boolean;
  groupConfig?: WechatGroupConfig;
  wildcardConfig?: WechatGroupConfig;
  hasConfiguredGroups: boolean;
};

export function resolveWechatGroupMatch(params: {
  groups?: Record<string, WechatGroupConfig>;
  target: string;
}): WechatGroupMatch {
  const groups = params.groups ?? {};
  const hasConfiguredGroups = Object.keys(groups).length > 0;

  // Match by room topic (case-insensitive)
  const direct = groups[params.target];
  if (direct) {
    return { allowed: true, groupConfig: direct, wildcardConfig: groups["*"], hasConfiguredGroups };
  }
  const targetLower = params.target.toLowerCase();
  const directKey = Object.keys(groups).find((key) => key.toLowerCase() === targetLower);
  if (directKey) {
    const matched = groups[directKey];
    if (matched) {
      return {
        allowed: true,
        groupConfig: matched,
        wildcardConfig: groups["*"],
        hasConfiguredGroups,
      };
    }
  }

  const wildcard = groups["*"];
  if (wildcard) {
    return { allowed: true, wildcardConfig: wildcard, hasConfiguredGroups };
  }
  return { allowed: false, hasConfiguredGroups };
}

export function resolveWechatGroupAccessGate(params: {
  groupPolicy: WechatAccountConfig["groupPolicy"];
  groupMatch: WechatGroupMatch;
}): { allowed: boolean; reason: string } {
  const policy = params.groupPolicy ?? "allowlist";
  if (policy === "disabled") {
    return { allowed: false, reason: "groupPolicy=disabled" };
  }
  if (policy === "allowlist") {
    if (!params.groupMatch.hasConfiguredGroups) {
      return { allowed: false, reason: "groupPolicy=allowlist and no groups configured" };
    }
    if (!params.groupMatch.allowed) {
      return { allowed: false, reason: "not allowlisted" };
    }
  }
  if (
    params.groupMatch.groupConfig?.enabled === false ||
    params.groupMatch.wildcardConfig?.enabled === false
  ) {
    return { allowed: false, reason: "disabled" };
  }
  return { allowed: true, reason: policy === "open" ? "open" : "allowlisted" };
}

export function resolveWechatRequireMention(params: {
  groupConfig?: WechatGroupConfig;
  wildcardConfig?: WechatGroupConfig;
}): boolean {
  if (params.groupConfig?.requireMention !== undefined) {
    return params.groupConfig.requireMention;
  }
  if (params.wildcardConfig?.requireMention !== undefined) {
    return params.wildcardConfig.requireMention;
  }
  return true;
}

export function resolveWechatMentionGate(params: {
  isGroup: boolean;
  requireMention: boolean;
  wasMentioned: boolean;
  hasControlCommand: boolean;
  allowTextCommands: boolean;
  commandAuthorized: boolean;
}): { shouldSkip: boolean; reason: string } {
  if (!params.isGroup) {
    return { shouldSkip: false, reason: "direct" };
  }
  if (!params.requireMention) {
    return { shouldSkip: false, reason: "mention-not-required" };
  }
  if (params.wasMentioned) {
    return { shouldSkip: false, reason: "mentioned" };
  }
  if (params.hasControlCommand && params.allowTextCommands && params.commandAuthorized) {
    return { shouldSkip: false, reason: "authorized-command" };
  }
  return { shouldSkip: true, reason: "missing-mention" };
}

export function resolveWechatGroupSenderAllowed(params: {
  groupPolicy: WechatAccountConfig["groupPolicy"];
  message: WechatInboundMessage;
  outerAllowFrom: string[];
  innerAllowFrom: string[];
}): boolean {
  const policy = params.groupPolicy ?? "allowlist";
  const inner = normalizeWechatAllowlist(params.innerAllowFrom);
  const outer = normalizeWechatAllowlist(params.outerAllowFrom);

  if (inner.length > 0) {
    return resolveWechatAllowlistMatch({ allowFrom: inner, message: params.message }).allowed;
  }
  if (outer.length > 0) {
    return resolveWechatAllowlistMatch({ allowFrom: outer, message: params.message }).allowed;
  }
  return policy === "open";
}
