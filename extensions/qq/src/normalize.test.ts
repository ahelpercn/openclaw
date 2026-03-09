import { describe, expect, it } from "vitest";
import {
  isGroupTarget,
  looksLikeQqId,
  normalizeQqAllowEntry,
  normalizeQqAllowlist,
  normalizeQqMessagingTarget,
  resolveQqAllowlistMatch,
  stripGroupPrefix,
} from "./normalize.js";
import type { QqInboundMessage } from "./types.js";

const stubMessage = (senderId: string): QqInboundMessage => ({
  messageId: "1",
  target: senderId,
  senderId,
  text: "test",
  timestamp: Date.now(),
  isGroup: false,
});

describe("isGroupTarget", () => {
  it("returns true for group:-prefixed targets", () => {
    expect(isGroupTarget("group:ABCDEF1234567890")).toBe(true);
    expect(isGroupTarget("group:123456")).toBe(true);
  });

  it("returns false for non-prefixed targets", () => {
    expect(isGroupTarget("ABCDEF1234567890")).toBe(false);
    expect(isGroupTarget("123456")).toBe(false);
    expect(isGroupTarget("")).toBe(false);
  });
});

describe("stripGroupPrefix", () => {
  it("strips group: prefix", () => {
    expect(stripGroupPrefix("group:ABCDEF1234567890")).toBe("ABCDEF1234567890");
  });

  it("returns unchanged for non-prefixed targets", () => {
    expect(stripGroupPrefix("ABCDEF1234567890")).toBe("ABCDEF1234567890");
    expect(stripGroupPrefix("123456")).toBe("123456");
  });
});

describe("looksLikeQqId", () => {
  it("accepts 5-12 digit QQ numbers", () => {
    expect(looksLikeQqId("12345")).toBe(true);
    expect(looksLikeQqId("123456789012")).toBe(true);
  });

  it("accepts openid format (16+ alphanumeric chars)", () => {
    expect(looksLikeQqId("ABCDEF1234567890")).toBe(true);
    expect(looksLikeQqId("abc123def456ghi7")).toBe(true);
    expect(looksLikeQqId("A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6")).toBe(true);
  });

  it("rejects too-short strings", () => {
    expect(looksLikeQqId("1234")).toBe(false);
    expect(looksLikeQqId("abc")).toBe(false);
  });

  it("rejects strings with special characters", () => {
    expect(looksLikeQqId("abc@def.com")).toBe(false);
    expect(looksLikeQqId("hello world")).toBe(false);
  });
});

describe("normalizeQqMessagingTarget", () => {
  it("strips qq: prefix", () => {
    expect(normalizeQqMessagingTarget("qq:123456789")).toBe("123456789");
  });

  it("strips group: prefix", () => {
    expect(normalizeQqMessagingTarget("group:123456789")).toBe("123456789");
  });

  it("strips user: prefix", () => {
    expect(normalizeQqMessagingTarget("user:123456789")).toBe("123456789");
  });

  it("strips combined qq:user: prefix", () => {
    expect(normalizeQqMessagingTarget("qq:user:123456789")).toBe("123456789");
  });

  it("returns undefined for empty string", () => {
    expect(normalizeQqMessagingTarget("")).toBeUndefined();
  });

  it("returns undefined for invalid QQ id", () => {
    expect(normalizeQqMessagingTarget("abc")).toBeUndefined();
    expect(normalizeQqMessagingTarget("qq:short")).toBeUndefined();
  });

  it("handles bare QQ number", () => {
    expect(normalizeQqMessagingTarget("987654321")).toBe("987654321");
  });
});

describe("normalizeQqAllowEntry", () => {
  it("strips qq: prefix and lowercases", () => {
    expect(normalizeQqAllowEntry("QQ:123456789")).toBe("123456789");
  });

  it("strips user: prefix", () => {
    expect(normalizeQqAllowEntry("user:123456789")).toBe("123456789");
  });

  it("returns empty for blank input", () => {
    expect(normalizeQqAllowEntry("")).toBe("");
    expect(normalizeQqAllowEntry("   ")).toBe("");
  });

  it("passes through wildcard", () => {
    expect(normalizeQqAllowEntry("*")).toBe("*");
  });
});

describe("normalizeQqAllowlist", () => {
  it("normalizes an array of entries", () => {
    expect(normalizeQqAllowlist(["QQ:111", 222, "user:333"])).toEqual(["111", "222", "333"]);
  });

  it("filters empty entries", () => {
    expect(normalizeQqAllowlist(["", "   ", "12345"])).toEqual(["12345"]);
  });

  it("handles undefined", () => {
    expect(normalizeQqAllowlist(undefined)).toEqual([]);
  });
});

describe("resolveQqAllowlistMatch", () => {
  it("allows wildcard", () => {
    const result = resolveQqAllowlistMatch({
      allowFrom: ["*"],
      message: stubMessage("999999"),
    });
    expect(result).toEqual({ allowed: true, source: "wildcard" });
  });

  it("allows matching sender", () => {
    const result = resolveQqAllowlistMatch({
      allowFrom: ["123456", "789012"],
      message: stubMessage("789012"),
    });
    expect(result).toEqual({ allowed: true, source: "789012" });
  });

  it("rejects unmatched sender", () => {
    const result = resolveQqAllowlistMatch({
      allowFrom: ["123456"],
      message: stubMessage("999999"),
    });
    expect(result).toEqual({ allowed: false });
  });

  it("handles empty allowlist", () => {
    const result = resolveQqAllowlistMatch({
      allowFrom: [],
      message: stubMessage("123456"),
    });
    expect(result).toEqual({ allowed: false });
  });
});
