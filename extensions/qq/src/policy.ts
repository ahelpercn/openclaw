import { normalizeQqAllowlist, resolveQqAllowlistMatch } from "./normalize.js";
import type { QqAccountConfig, QqGroupConfig, QqInboundMessage } from "./types.js";

export type QqGroupMatch = {
  allowed: boolean;
  groupConfig?: QqGroupConfig;
  wildcardConfig?: QqGroupConfig;
  hasConfiguredGroups: boolean;
};

export type QqGroupAccessGate = {
  allowed: boolean;
  reason: string;
};

/** Match a group target against configured groups. */
export function resolveQqGroupMatch(params: {
  groups?: Record<string, QqGroupConfig>;
  target: string;
}): QqGroupMatch {
  const groups = params.groups ?? {};
  const hasConfiguredGroups = Object.keys(groups).length > 0;

  const direct = groups[params.target];
  if (direct) {
    return {
      allowed: true,
      groupConfig: direct,
      wildcardConfig: groups["*"],
      hasConfiguredGroups,
    };
  }

  const wildcard = groups["*"];
  if (wildcard) {
    return {
      allowed: true,
      wildcardConfig: wildcard,
      hasConfiguredGroups,
    };
  }
  return { allowed: false, hasConfiguredGroups };
}

/** Evaluate group access policy. */
export function resolveQqGroupAccessGate(params: {
  groupPolicy: QqAccountConfig["groupPolicy"];
  groupMatch: QqGroupMatch;
}): QqGroupAccessGate {
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

/** Resolve whether mention is required for a group. */
export function resolveQqRequireMention(params: {
  groupConfig?: QqGroupConfig;
  wildcardConfig?: QqGroupConfig;
}): boolean {
  if (params.groupConfig?.requireMention !== undefined) {
    return params.groupConfig.requireMention;
  }
  if (params.wildcardConfig?.requireMention !== undefined) {
    return params.wildcardConfig.requireMention;
  }
  return true;
}

/** Gate message based on mention requirement. */
export function resolveQqMentionGate(params: {
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

/** Check if sender is allowed in a group. */
export function resolveQqGroupSenderAllowed(params: {
  groupPolicy: QqAccountConfig["groupPolicy"];
  message: QqInboundMessage;
  outerAllowFrom: string[];
  innerAllowFrom: string[];
}): boolean {
  const policy = params.groupPolicy ?? "allowlist";
  const inner = normalizeQqAllowlist(params.innerAllowFrom);
  const outer = normalizeQqAllowlist(params.outerAllowFrom);

  if (inner.length > 0) {
    return resolveQqAllowlistMatch({ allowFrom: inner, message: params.message }).allowed;
  }
  if (outer.length > 0) {
    return resolveQqAllowlistMatch({ allowFrom: outer, message: params.message }).allowed;
  }
  return policy === "open";
}
