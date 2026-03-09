import { describe, expect, it } from "vitest";
import {
  looksLikeWecomId,
  normalizeWecomAllowEntry,
  normalizeWecomAllowlist,
  normalizeWecomMessagingTarget,
  resolveWecomAllowlistMatch,
} from "./normalize.js";
import type { WecomInboundMessage } from "./types.js";

const stubMessage = (fromUser: string): WecomInboundMessage => ({
  messageId: "1",
  msgType: "text",
  content: "test",
  fromUser,
  createTime: Date.now(),
  isGroup: false,
});

describe("looksLikeWecomId", () => {
  it("accepts alphanumeric IDs", () => {
    expect(looksLikeWecomId("zhangsan")).toBe(true);
    expect(looksLikeWecomId("user123")).toBe(true);
    expect(looksLikeWecomId("test.user")).toBe(true);
    expect(looksLikeWecomId("user@dept")).toBe(true);
    expect(looksLikeWecomId("user-name")).toBe(true);
  });

  it("rejects empty strings", () => {
    expect(looksLikeWecomId("")).toBe(false);
    expect(looksLikeWecomId("   ")).toBe(false);
  });
});

describe("normalizeWecomMessagingTarget", () => {
  it("strips wecom: prefix", () => {
    expect(normalizeWecomMessagingTarget("wecom:zhangsan")).toBe("zhangsan");
  });

  it("strips user: prefix", () => {
    expect(normalizeWecomMessagingTarget("user:zhangsan")).toBe("zhangsan");
  });

  it("strips group: prefix", () => {
    expect(normalizeWecomMessagingTarget("group:dept_chat")).toBe("dept_chat");
  });

  it("strips combined wecom:user: prefix", () => {
    expect(normalizeWecomMessagingTarget("wecom:user:lisi")).toBe("lisi");
  });

  it("returns undefined for empty string", () => {
    expect(normalizeWecomMessagingTarget("")).toBeUndefined();
  });

  it("handles plain user IDs", () => {
    expect(normalizeWecomMessagingTarget("zhangsan")).toBe("zhangsan");
  });
});

describe("normalizeWecomAllowEntry", () => {
  it("strips wecom: prefix and lowercases", () => {
    expect(normalizeWecomAllowEntry("WeCom:ZhangSan")).toBe("zhangsan");
  });

  it("strips user: prefix", () => {
    expect(normalizeWecomAllowEntry("user:LiSi")).toBe("lisi");
  });

  it("returns empty for blank input", () => {
    expect(normalizeWecomAllowEntry("")).toBe("");
  });

  it("passes through wildcard", () => {
    expect(normalizeWecomAllowEntry("*")).toBe("*");
  });
});

describe("normalizeWecomAllowlist", () => {
  it("normalizes entries", () => {
    expect(normalizeWecomAllowlist(["wecom:User1", "user2", 12345])).toEqual([
      "user1",
      "user2",
      "12345",
    ]);
  });

  it("filters empty entries", () => {
    expect(normalizeWecomAllowlist(["", "  ", "zhangsan"])).toEqual(["zhangsan"]);
  });

  it("handles undefined", () => {
    expect(normalizeWecomAllowlist(undefined)).toEqual([]);
  });
});

describe("resolveWecomAllowlistMatch", () => {
  it("allows wildcard", () => {
    const result = resolveWecomAllowlistMatch({
      allowFrom: ["*"],
      message: stubMessage("anyone"),
    });
    expect(result).toEqual({ allowed: true, source: "wildcard" });
  });

  it("allows matching user", () => {
    const result = resolveWecomAllowlistMatch({
      allowFrom: ["zhangsan", "lisi"],
      message: stubMessage("lisi"),
    });
    expect(result).toEqual({ allowed: true, source: "lisi" });
  });

  it("rejects unmatched user", () => {
    const result = resolveWecomAllowlistMatch({
      allowFrom: ["zhangsan"],
      message: stubMessage("wangwu"),
    });
    expect(result).toEqual({ allowed: false });
  });

  it("case-insensitive matching", () => {
    const result = resolveWecomAllowlistMatch({
      allowFrom: ["ZhangSan"],
      message: stubMessage("zhangsan"),
    });
    expect(result).toEqual({ allowed: true, source: "zhangsan" });
  });
});
