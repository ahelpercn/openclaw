import type { WecomInboundMessage } from "./types.js";

/** Normalize a WeCom messaging target (strip prefixes). */
export function normalizeWecomMessagingTarget(raw: string): string | undefined {
  let target = raw.trim();
  if (!target) {
    return undefined;
  }
  const lowered = target.toLowerCase();
  if (lowered.startsWith("wecom:")) {
    target = target.slice("wecom:".length).trim();
  }
  if (target.toLowerCase().startsWith("user:")) {
    target = target.slice("user:".length).trim();
  }
  if (target.toLowerCase().startsWith("group:")) {
    target = target.slice("group:".length).trim();
  }
  if (!target || !looksLikeWecomId(target)) {
    return undefined;
  }
  return target;
}

/** WeCom user IDs are alphanumeric strings (e.g. "zhangsan", "user123"). */
export function looksLikeWecomId(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.length > 0 && /^[\w.@-]+$/i.test(trimmed);
}

/** Normalize an allowlist entry. */
export function normalizeWecomAllowEntry(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) {
    return "";
  }
  if (value.startsWith("wecom:")) {
    value = value.slice("wecom:".length);
  }
  if (value.startsWith("user:")) {
    value = value.slice("user:".length);
  }
  return value.trim();
}

/** Normalize allowlist entries. */
export function normalizeWecomAllowlist(entries?: Array<string | number>): string[] {
  return (entries ?? []).map((entry) => normalizeWecomAllowEntry(String(entry))).filter(Boolean);
}

/** Check if a sender matches the allowlist. */
export function resolveWecomAllowlistMatch(params: {
  allowFrom: string[];
  message: WecomInboundMessage;
}): { allowed: boolean; source?: string } {
  const allowFrom = new Set(
    params.allowFrom.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
  );
  if (allowFrom.has("*")) {
    return { allowed: true, source: "wildcard" };
  }
  const fromUser = params.message.fromUser.trim().toLowerCase();
  if (allowFrom.has(fromUser)) {
    return { allowed: true, source: fromUser };
  }
  return { allowed: false };
}
