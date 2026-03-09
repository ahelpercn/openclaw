import type { WechatInboundMessage } from "./types.js";

/** Normalize a WeChat messaging target (strip prefixes). */
export function normalizeWechatMessagingTarget(raw: string): string | undefined {
  let target = raw.trim();
  if (!target) {
    return undefined;
  }
  const lowered = target.toLowerCase();
  if (lowered.startsWith("wechat:")) {
    target = target.slice("wechat:".length).trim();
  }
  if (target.toLowerCase().startsWith("room:")) {
    target = target.slice("room:".length).trim();
  }
  if (target.toLowerCase().startsWith("user:")) {
    target = target.slice("user:".length).trim();
  }
  if (!target) {
    return undefined;
  }
  return target;
}

/** WeChat IDs can be wxid_xxxx format or alphanumeric. */
export function looksLikeWechatId(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.length > 0 && /^[\w.@-]+$/i.test(trimmed);
}

/** Normalize an allowlist entry. */
export function normalizeWechatAllowEntry(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) {
    return "";
  }
  if (value.startsWith("wechat:")) {
    value = value.slice("wechat:".length);
  }
  if (value.startsWith("user:")) {
    value = value.slice("user:".length);
  }
  return value.trim();
}

/** Normalize allowlist entries. */
export function normalizeWechatAllowlist(entries?: Array<string | number>): string[] {
  return (entries ?? []).map((entry) => normalizeWechatAllowEntry(String(entry))).filter(Boolean);
}

/** Check if a sender matches the allowlist. */
export function resolveWechatAllowlistMatch(params: {
  allowFrom: string[];
  message: WechatInboundMessage;
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
  // Also match by sender name for convenience
  const senderName = params.message.senderName?.trim().toLowerCase();
  if (senderName && allowFrom.has(senderName)) {
    return { allowed: true, source: senderName };
  }
  return { allowed: false };
}
