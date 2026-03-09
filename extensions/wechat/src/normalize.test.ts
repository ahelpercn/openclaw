import { describe, expect, it } from "vitest";
import {
  looksLikeWechatId,
  normalizeWechatAllowEntry,
  normalizeWechatAllowlist,
  normalizeWechatMessagingTarget,
  resolveWechatAllowlistMatch,
} from "./normalize.js";
import type { WechatInboundMessage } from "./types.js";

const stubMessage = (senderId: string, senderName?: string): WechatInboundMessage => ({
  messageId: "1",
  text: "test",
  senderId,
  senderName,
  isGroup: false,
  timestamp: Date.now(),
  target: senderId,
});

describe("looksLikeWechatId", () => {
  it("accepts wxid format", () => {
    expect(looksLikeWechatId("wxid_abc123")).toBe(true);
  });

  it("accepts alphanumeric IDs", () => {
    expect(looksLikeWechatId("user123")).toBe(true);
    expect(looksLikeWechatId("test.user")).toBe(true);
  });

  it("rejects empty strings", () => {
    expect(looksLikeWechatId("")).toBe(false);
    expect(looksLikeWechatId("   ")).toBe(false);
  });
});

describe("normalizeWechatMessagingTarget", () => {
  it("strips wechat: prefix", () => {
    expect(normalizeWechatMessagingTarget("wechat:wxid_abc123")).toBe("wxid_abc123");
  });

  it("strips room: prefix", () => {
    expect(normalizeWechatMessagingTarget("room:test_room")).toBe("test_room");
  });

  it("strips user: prefix", () => {
    expect(normalizeWechatMessagingTarget("user:wxid_abc123")).toBe("wxid_abc123");
  });

  it("strips combined wechat:user: prefix", () => {
    expect(normalizeWechatMessagingTarget("wechat:user:wxid_abc")).toBe("wxid_abc");
  });

  it("returns undefined for empty string", () => {
    expect(normalizeWechatMessagingTarget("")).toBeUndefined();
  });

  it("handles bare IDs", () => {
    expect(normalizeWechatMessagingTarget("wxid_abc123")).toBe("wxid_abc123");
  });
});

describe("normalizeWechatAllowEntry", () => {
  it("strips wechat: prefix and lowercases", () => {
    expect(normalizeWechatAllowEntry("WeChat:WxId_ABC")).toBe("wxid_abc");
  });

  it("strips user: prefix", () => {
    expect(normalizeWechatAllowEntry("user:SomeUser")).toBe("someuser");
  });

  it("returns empty for blank input", () => {
    expect(normalizeWechatAllowEntry("")).toBe("");
  });

  it("passes through wildcard", () => {
    expect(normalizeWechatAllowEntry("*")).toBe("*");
  });
});

describe("normalizeWechatAllowlist", () => {
  it("normalizes entries", () => {
    expect(normalizeWechatAllowlist(["wechat:User1", "wxid_abc", 12345])).toEqual([
      "user1",
      "wxid_abc",
      "12345",
    ]);
  });

  it("filters empty entries", () => {
    expect(normalizeWechatAllowlist(["", "  ", "wxid_ok"])).toEqual(["wxid_ok"]);
  });

  it("handles undefined", () => {
    expect(normalizeWechatAllowlist(undefined)).toEqual([]);
  });
});

describe("resolveWechatAllowlistMatch", () => {
  it("allows wildcard", () => {
    const result = resolveWechatAllowlistMatch({
      allowFrom: ["*"],
      message: stubMessage("anyone"),
    });
    expect(result).toEqual({ allowed: true, source: "wildcard" });
  });

  it("allows matching sender ID", () => {
    const result = resolveWechatAllowlistMatch({
      allowFrom: ["wxid_abc123"],
      message: stubMessage("wxid_abc123"),
    });
    expect(result).toEqual({ allowed: true, source: "wxid_abc123" });
  });

  it("allows matching by sender name", () => {
    const result = resolveWechatAllowlistMatch({
      allowFrom: ["alice"],
      message: stubMessage("wxid_unknown", "Alice"),
    });
    expect(result).toEqual({ allowed: true, source: "alice" });
  });

  it("rejects unmatched sender", () => {
    const result = resolveWechatAllowlistMatch({
      allowFrom: ["wxid_allowed"],
      message: stubMessage("wxid_other", "Bob"),
    });
    expect(result).toEqual({ allowed: false });
  });

  it("case-insensitive matching", () => {
    const result = resolveWechatAllowlistMatch({
      allowFrom: ["WxId_ABC123"],
      message: stubMessage("wxid_abc123"),
    });
    expect(result).toEqual({ allowed: true, source: "wxid_abc123" });
  });
});
