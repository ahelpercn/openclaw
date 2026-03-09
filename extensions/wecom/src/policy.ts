import { normalizeWecomAllowlist, resolveWecomAllowlistMatch } from "./normalize.js";
import type { WecomAccountConfig, WecomGroupConfig, WecomInboundMessage } from "./types.js";

export type WecomGroupMatch = {
  allowed: boolean;
  groupConfig?: WecomGroupConfig;
  wildcardConfig?: WecomGroupConfig;
  hasConfiguredGroups: boolean;
};

export type WecomGroupAccessGate = {
  allowed: boolean;
  reason: string;
};

export function resolveWecomGroupMatch(params: {
  groups?: Record<string, WecomGroupConfig>;
  target: string;
}): WecomGroupMatch {
  const groups = params.groups ?? {};
  const hasConfiguredGroups = Object.keys(groups).length > 0;

  const direct = groups[params.target];
  if (direct) {
    return { allowed: true, groupConfig: direct, wildcardConfig: groups["*"], hasConfiguredGroups };
  }

  const wildcard = groups["*"];
  if (wildcard) {
    return { allowed: true, wildcardConfig: wildcard, hasConfiguredGroups };
  }
  return { allowed: false, hasConfiguredGroups };
}

export function resolveWecomGroupAccessGate(params: {
  groupPolicy: WecomAccountConfig["groupPolicy"];
  groupMatch: WecomGroupMatch;
}): WecomGroupAccessGate {
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

export function resolveWecomRequireMention(params: {
  groupConfig?: WecomGroupConfig;
  wildcardConfig?: WecomGroupConfig;
}): boolean {
  if (params.groupConfig?.requireMention !== undefined) {
    return params.groupConfig.requireMention;
  }
  if (params.wildcardConfig?.requireMention !== undefined) {
    return params.wildcardConfig.requireMention;
  }
  return true;
}

export function resolveWecomMentionGate(params: {
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

export function resolveWecomGroupSenderAllowed(params: {
  groupPolicy: WecomAccountConfig["groupPolicy"];
  message: WecomInboundMessage;
  outerAllowFrom: string[];
  innerAllowFrom: string[];
}): boolean {
  const policy = params.groupPolicy ?? "allowlist";
  const inner = normalizeWecomAllowlist(params.innerAllowFrom);
  const outer = normalizeWecomAllowlist(params.outerAllowFrom);

  if (inner.length > 0) {
    return resolveWecomAllowlistMatch({ allowFrom: inner, message: params.message }).allowed;
  }
  if (outer.length > 0) {
    return resolveWecomAllowlistMatch({ allowFrom: outer, message: params.message }).allowed;
  }
  return policy === "open";
}
