import { describe, expect, it } from "vitest";
import {
  resolveQqGroupAccessGate,
  resolveQqGroupMatch,
  resolveQqGroupSenderAllowed,
  resolveQqMentionGate,
  resolveQqRequireMention,
} from "./policy.js";
import type { QqGroupConfig, QqInboundMessage } from "./types.js";

const stubGroupMessage = (target: string, senderId: string): QqInboundMessage => ({
  messageId: "1",
  target,
  senderId,
  text: "hello",
  timestamp: Date.now(),
  isGroup: true,
});

describe("resolveQqGroupMatch", () => {
  it("matches a directly-configured group", () => {
    const groups: Record<string, QqGroupConfig> = {
      "123456": { requireMention: false },
    };
    const result = resolveQqGroupMatch({ groups, target: "123456" });
    expect(result.allowed).toBe(true);
    expect(result.groupConfig).toEqual({ requireMention: false });
    expect(result.hasConfiguredGroups).toBe(true);
  });

  it("falls back to wildcard when no direct match", () => {
    const groups: Record<string, QqGroupConfig> = {
      "*": { requireMention: true },
    };
    const result = resolveQqGroupMatch({ groups, target: "999999" });
    expect(result.allowed).toBe(true);
    expect(result.groupConfig).toBeUndefined();
    expect(result.wildcardConfig).toEqual({ requireMention: true });
  });

  it("returns direct match + wildcard when both exist", () => {
    const groups: Record<string, QqGroupConfig> = {
      "123456": { requireMention: false },
      "*": { requireMention: true },
    };
    const result = resolveQqGroupMatch({ groups, target: "123456" });
    expect(result.allowed).toBe(true);
    expect(result.groupConfig?.requireMention).toBe(false);
    expect(result.wildcardConfig?.requireMention).toBe(true);
  });

  it("rejects unmatched group with no wildcard", () => {
    const groups: Record<string, QqGroupConfig> = {
      "123456": {},
    };
    const result = resolveQqGroupMatch({ groups, target: "999999" });
    expect(result.allowed).toBe(false);
    expect(result.hasConfiguredGroups).toBe(true);
  });

  it("reports no configured groups when empty", () => {
    const result = resolveQqGroupMatch({ groups: {}, target: "123456" });
    expect(result.allowed).toBe(false);
    expect(result.hasConfiguredGroups).toBe(false);
  });
});

describe("resolveQqGroupAccessGate", () => {
  it("blocks when groupPolicy=disabled", () => {
    const result = resolveQqGroupAccessGate({
      groupPolicy: "disabled",
      groupMatch: { allowed: true, hasConfiguredGroups: true },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("disabled");
  });

  it("blocks allowlist with no configured groups", () => {
    const result = resolveQqGroupAccessGate({
      groupPolicy: "allowlist",
      groupMatch: { allowed: false, hasConfiguredGroups: false },
    });
    expect(result.allowed).toBe(false);
  });

  it("blocks unmatched group in allowlist mode", () => {
    const result = resolveQqGroupAccessGate({
      groupPolicy: "allowlist",
      groupMatch: { allowed: false, hasConfiguredGroups: true },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("not allowlisted");
  });

  it("allows matched group in allowlist mode", () => {
    const result = resolveQqGroupAccessGate({
      groupPolicy: "allowlist",
      groupMatch: { allowed: true, hasConfiguredGroups: true },
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("allowlisted");
  });

  it("allows any group in open mode", () => {
    const result = resolveQqGroupAccessGate({
      groupPolicy: "open",
      groupMatch: { allowed: false, hasConfiguredGroups: false },
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("open");
  });

  it("blocks explicitly disabled group even in open mode", () => {
    const result = resolveQqGroupAccessGate({
      groupPolicy: "open",
      groupMatch: {
        allowed: true,
        groupConfig: { enabled: false },
        hasConfiguredGroups: true,
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("disabled");
  });
});

describe("resolveQqRequireMention", () => {
  it("uses groupConfig when set", () => {
    expect(resolveQqRequireMention({ groupConfig: { requireMention: false } })).toBe(false);
  });

  it("falls back to wildcardConfig", () => {
    expect(resolveQqRequireMention({ wildcardConfig: { requireMention: false } })).toBe(false);
  });

  it("defaults to true when neither is set", () => {
    expect(resolveQqRequireMention({})).toBe(true);
  });

  it("groupConfig takes precedence over wildcard", () => {
    expect(
      resolveQqRequireMention({
        groupConfig: { requireMention: true },
        wildcardConfig: { requireMention: false },
      }),
    ).toBe(true);
  });
});

describe("resolveQqMentionGate", () => {
  it("always passes for direct messages", () => {
    const result = resolveQqMentionGate({
      isGroup: false,
      requireMention: true,
      wasMentioned: false,
      hasControlCommand: false,
      allowTextCommands: false,
      commandAuthorized: false,
    });
    expect(result.shouldSkip).toBe(false);
    expect(result.reason).toBe("direct");
  });

  it("passes when mention not required", () => {
    const result = resolveQqMentionGate({
      isGroup: true,
      requireMention: false,
      wasMentioned: false,
      hasControlCommand: false,
      allowTextCommands: false,
      commandAuthorized: false,
    });
    expect(result.shouldSkip).toBe(false);
    expect(result.reason).toBe("mention-not-required");
  });

  it("passes when bot was mentioned", () => {
    const result = resolveQqMentionGate({
      isGroup: true,
      requireMention: true,
      wasMentioned: true,
      hasControlCommand: false,
      allowTextCommands: false,
      commandAuthorized: false,
    });
    expect(result.shouldSkip).toBe(false);
    expect(result.reason).toBe("mentioned");
  });

  it("passes for authorized control commands", () => {
    const result = resolveQqMentionGate({
      isGroup: true,
      requireMention: true,
      wasMentioned: false,
      hasControlCommand: true,
      allowTextCommands: true,
      commandAuthorized: true,
    });
    expect(result.shouldSkip).toBe(false);
    expect(result.reason).toBe("authorized-command");
  });

  it("skips when mention required but missing", () => {
    const result = resolveQqMentionGate({
      isGroup: true,
      requireMention: true,
      wasMentioned: false,
      hasControlCommand: false,
      allowTextCommands: false,
      commandAuthorized: false,
    });
    expect(result.shouldSkip).toBe(true);
    expect(result.reason).toBe("missing-mention");
  });
});

describe("resolveQqGroupSenderAllowed", () => {
  it("allows sender matching inner allowlist", () => {
    const result = resolveQqGroupSenderAllowed({
      groupPolicy: "allowlist",
      message: stubGroupMessage("888888", "123456"),
      outerAllowFrom: [],
      innerAllowFrom: ["123456"],
    });
    expect(result).toBe(true);
  });

  it("rejects sender not in inner allowlist", () => {
    const result = resolveQqGroupSenderAllowed({
      groupPolicy: "allowlist",
      message: stubGroupMessage("888888", "999999"),
      outerAllowFrom: [],
      innerAllowFrom: ["123456"],
    });
    expect(result).toBe(false);
  });

  it("falls back to outer allowlist when inner is empty", () => {
    const result = resolveQqGroupSenderAllowed({
      groupPolicy: "allowlist",
      message: stubGroupMessage("888888", "123456"),
      outerAllowFrom: ["123456"],
      innerAllowFrom: [],
    });
    expect(result).toBe(true);
  });

  it("allows any sender in open mode when no allowlists", () => {
    const result = resolveQqGroupSenderAllowed({
      groupPolicy: "open",
      message: stubGroupMessage("888888", "anyone"),
      outerAllowFrom: [],
      innerAllowFrom: [],
    });
    expect(result).toBe(true);
  });

  it("rejects in allowlist mode with empty lists", () => {
    const result = resolveQqGroupSenderAllowed({
      groupPolicy: "allowlist",
      message: stubGroupMessage("888888", "anyone"),
      outerAllowFrom: [],
      innerAllowFrom: [],
    });
    expect(result).toBe(false);
  });
});
