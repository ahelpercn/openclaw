import type { QqInboundMessage } from "./types.js";

const GROUP_PREFIX = "group:";

/** Check if a target is a group (uses "group:" prefix convention). */
export function isGroupTarget(target: string): boolean {
  return target.startsWith(GROUP_PREFIX);
}

/** Strip "group:" prefix if present, returning the raw openid. */
export function stripGroupPrefix(target: string): string {
  return target.startsWith(GROUP_PREFIX) ? target.slice(GROUP_PREFIX.length) : target;
}

/** Normalize a messaging target string (strip prefixes like "qq:", "group:", "user:"). */
export function normalizeQqMessagingTarget(raw: string): string | undefined {
  let target = raw.trim();
  if (!target) {
    return undefined;
  }
  const lowered = target.toLowerCase();
  if (lowered.startsWith("qq:")) {
    target = target.slice("qq:".length).trim();
  }
  if (target.toLowerCase().startsWith("group:")) {
    target = target.slice("group:".length).trim();
  }
  if (target.toLowerCase().startsWith("user:")) {
    target = target.slice("user:".length).trim();
  }
  if (!target || !looksLikeQqId(target)) {
    return undefined;
  }
  return target;
}

/**
 * Check if a string looks like a valid QQ identifier.
 * Accepts QQ numbers (5-12 digits) and openids (alphanumeric, 16+ chars).
 */
export function looksLikeQqId(raw: string): boolean {
  const trimmed = raw.trim();
  // QQ number (classic) or openid (official API, hex/alphanumeric 16+ chars)
  return /^\d{5,12}$/.test(trimmed) || /^[A-Za-z0-9_-]{16,128}$/.test(trimmed);
}

/** Normalize an allowlist entry (strip prefixes, lowercase). */
export function normalizeQqAllowEntry(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) {
    return "";
  }
  if (value.startsWith("qq:")) {
    value = value.slice("qq:".length);
  }
  if (value.startsWith("user:")) {
    value = value.slice("user:".length);
  }
  return value.trim();
}

/** Normalize allowlist entries. */
export function normalizeQqAllowlist(entries?: Array<string | number>): string[] {
  return (entries ?? []).map((entry) => normalizeQqAllowEntry(String(entry))).filter(Boolean);
}

/** Check if a sender matches the allowlist. */
export function resolveQqAllowlistMatch(params: {
  allowFrom: string[];
  message: QqInboundMessage;
}): { allowed: boolean; source?: string } {
  const allowFrom = new Set(
    params.allowFrom.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
  );
  if (allowFrom.has("*")) {
    return { allowed: true, source: "wildcard" };
  }
  const senderId = params.message.senderId.trim().toLowerCase();
  if (allowFrom.has(senderId)) {
    return { allowed: true, source: senderId };
  }
  return { allowed: false };
}
