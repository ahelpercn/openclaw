import { describe, expect, it } from "vitest";
import {
  buildHeartbeat,
  buildIdentify,
  buildResume,
  DEFAULT_INTENTS,
  EVENT_AT_MESSAGE_CREATE,
  EVENT_C2C_MESSAGE_CREATE,
  EVENT_DIRECT_MESSAGE_CREATE,
  EVENT_GROUP_AT_MESSAGE_CREATE,
  EVENT_MESSAGE_CREATE,
  extractPlainText,
  Intents,
  isGroupEvent,
  isMessageEvent,
  OpCode,
  parseGatewayPayload,
} from "./qqbot-api.js";

describe("OpCode", () => {
  it("defines standard gateway opcodes", () => {
    expect(OpCode.Dispatch).toBe(0);
    expect(OpCode.Heartbeat).toBe(1);
    expect(OpCode.Identify).toBe(2);
    expect(OpCode.Resume).toBe(6);
    expect(OpCode.Reconnect).toBe(7);
    expect(OpCode.InvalidSession).toBe(9);
    expect(OpCode.Hello).toBe(10);
    expect(OpCode.HeartbeatAck).toBe(11);
  });
});

describe("Intents", () => {
  it("defines correct bit positions", () => {
    expect(Intents.GUILDS).toBe(1);
    expect(Intents.GROUP_AND_C2C_EVENT).toBe(1 << 25);
    expect(Intents.PUBLIC_GUILD_MESSAGES).toBe(1 << 30);
  });

  it("DEFAULT_INTENTS includes group + public guild", () => {
    expect(DEFAULT_INTENTS & Intents.GROUP_AND_C2C_EVENT).toBeTruthy();
    expect(DEFAULT_INTENTS & Intents.PUBLIC_GUILD_MESSAGES).toBeTruthy();
    expect(DEFAULT_INTENTS & Intents.GUILDS).toBeFalsy();
  });
});

describe("extractPlainText", () => {
  it("strips @mention markup", () => {
    expect(extractPlainText("<@!12345> hello")).toBe("hello");
    expect(extractPlainText("<@!999> foo <@!888> bar")).toBe("foo  bar");
  });

  it("returns trimmed text without mentions", () => {
    expect(extractPlainText("  hello world  ")).toBe("hello world");
  });

  it("handles empty content", () => {
    expect(extractPlainText("")).toBe("");
    expect(extractPlainText("   ")).toBe("");
  });

  it("passes through plain text", () => {
    expect(extractPlainText("no mentions here")).toBe("no mentions here");
  });
});

describe("buildIdentify", () => {
  it("builds a valid identify payload", () => {
    const payload = JSON.parse(buildIdentify("test-token", 33554432));
    expect(payload.op).toBe(OpCode.Identify);
    expect(payload.d.token).toBe("QQBot test-token");
    expect(payload.d.intents).toBe(33554432);
    expect(payload.d.shard).toEqual([0, 1]);
    expect(payload.d.properties.$browser).toBe("openclaw");
  });

  it("accepts custom shard", () => {
    const payload = JSON.parse(buildIdentify("token", 1, [1, 4]));
    expect(payload.d.shard).toEqual([1, 4]);
  });
});

describe("buildHeartbeat", () => {
  it("builds heartbeat with sequence number", () => {
    const payload = JSON.parse(buildHeartbeat(42));
    expect(payload.op).toBe(OpCode.Heartbeat);
    expect(payload.d).toBe(42);
  });

  it("builds heartbeat with null sequence", () => {
    const payload = JSON.parse(buildHeartbeat(null));
    expect(payload.op).toBe(OpCode.Heartbeat);
    expect(payload.d).toBeNull();
  });
});

describe("buildResume", () => {
  it("builds a valid resume payload", () => {
    const payload = JSON.parse(buildResume("token123", "session-abc", 99));
    expect(payload.op).toBe(OpCode.Resume);
    expect(payload.d.token).toBe("QQBot token123");
    expect(payload.d.session_id).toBe("session-abc");
    expect(payload.d.seq).toBe(99);
  });
});

describe("parseGatewayPayload", () => {
  it("parses valid payload", () => {
    const result = parseGatewayPayload('{"op":10,"d":{"heartbeat_interval":41250}}');
    expect(result).toEqual({ op: 10, d: { heartbeat_interval: 41250 } });
  });

  it("parses dispatch event", () => {
    const result = parseGatewayPayload(
      '{"op":0,"s":1,"t":"READY","d":{"session_id":"abc","user":{"id":"bot1"}}}',
    );
    expect(result?.op).toBe(0);
    expect(result?.t).toBe("READY");
    expect(result?.s).toBe(1);
  });

  it("returns null for invalid JSON", () => {
    expect(parseGatewayPayload("not json")).toBeNull();
    expect(parseGatewayPayload("")).toBeNull();
  });

  it("returns null for object without op field", () => {
    expect(parseGatewayPayload('{"d":"hello"}')).toBeNull();
  });
});

describe("isMessageEvent", () => {
  it("recognizes C2C message event", () => {
    expect(isMessageEvent(EVENT_C2C_MESSAGE_CREATE)).toBe(true);
  });

  it("recognizes group @bot event", () => {
    expect(isMessageEvent(EVENT_GROUP_AT_MESSAGE_CREATE)).toBe(true);
  });

  it("recognizes guild public @bot event", () => {
    expect(isMessageEvent(EVENT_AT_MESSAGE_CREATE)).toBe(true);
  });

  it("recognizes guild private message event", () => {
    expect(isMessageEvent(EVENT_MESSAGE_CREATE)).toBe(true);
  });

  it("recognizes guild DM event", () => {
    expect(isMessageEvent(EVENT_DIRECT_MESSAGE_CREATE)).toBe(true);
  });

  it("rejects unknown events", () => {
    expect(isMessageEvent("GUILD_CREATE")).toBe(false);
    expect(isMessageEvent("")).toBe(false);
    expect(isMessageEvent(undefined)).toBe(false);
  });
});

describe("isGroupEvent", () => {
  it("returns true for group @bot event", () => {
    expect(isGroupEvent(EVENT_GROUP_AT_MESSAGE_CREATE)).toBe(true);
  });

  it("returns true for guild public event", () => {
    expect(isGroupEvent(EVENT_AT_MESSAGE_CREATE)).toBe(true);
  });

  it("returns true for guild private message event", () => {
    expect(isGroupEvent(EVENT_MESSAGE_CREATE)).toBe(true);
  });

  it("returns false for C2C message event", () => {
    expect(isGroupEvent(EVENT_C2C_MESSAGE_CREATE)).toBe(false);
  });

  it("returns false for guild DM event", () => {
    expect(isGroupEvent(EVENT_DIRECT_MESSAGE_CREATE)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isGroupEvent(undefined)).toBe(false);
  });
});
