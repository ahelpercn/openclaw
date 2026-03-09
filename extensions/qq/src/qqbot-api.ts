/**
 * QQ Official Bot API types and helpers.
 * Replaces onebot.ts (OneBot v11 protocol).
 * @see https://bot.q.qq.com/wiki/develop/api-v2/
 */

// --- WebSocket OpCodes ---

export const OpCode = {
  /** Server pushes events to client */
  Dispatch: 0,
  /** Heartbeat ping/pong */
  Heartbeat: 1,
  /** Client sends auth after connect */
  Identify: 2,
  /** Client sends to reconnect and replay */
  Resume: 6,
  /** Server demands reconnect */
  Reconnect: 7,
  /** Auth failed or session invalid */
  InvalidSession: 9,
  /** First message after connect, has heartbeat_interval */
  Hello: 10,
  /** Server acknowledges heartbeat */
  HeartbeatAck: 11,
} as const;

// --- Intent bits ---

export const Intents = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 9,
  GUILD_MESSAGE_REACTIONS: 1 << 10,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C_EVENT: 1 << 25,
  INTERACTION: 1 << 26,
  MESSAGE_AUDIT: 1 << 27,
  FORUMS_EVENT: 1 << 28,
  AUDIO_ACTION: 1 << 29,
  PUBLIC_GUILD_MESSAGES: 1 << 30,
} as const;

/** Default intents for OpenClaw: group + C2C messages + guild public messages */
export const DEFAULT_INTENTS = Intents.GROUP_AND_C2C_EVENT | Intents.PUBLIC_GUILD_MESSAGES;

// --- Gateway payload types ---

export type GatewayPayload = {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
  id?: string;
};

export type HelloData = {
  heartbeat_interval: number;
};

export type ReadyData = {
  version: number;
  session_id: string;
  user: {
    id: string;
    username: string;
    bot: boolean;
  };
  shard: [number, number];
};

// --- Message event types ---

export type C2CMessageAuthor = {
  user_openid: string;
};

export type GroupMessageAuthor = {
  member_openid: string;
};

export type GuildMessageAuthor = {
  id: string;
  username: string;
  avatar?: string;
  bot: boolean;
};

export type MessageAttachment = {
  content_type: string;
  filename: string;
  url: string;
  size?: number;
  width?: number;
  height?: number;
};

export type C2CMessageEvent = {
  id: string;
  author: C2CMessageAuthor;
  content: string;
  timestamp: string;
  attachments?: MessageAttachment[];
};

export type GroupMessageEvent = {
  id: string;
  author: GroupMessageAuthor;
  content: string;
  timestamp: string;
  group_openid: string;
  attachments?: MessageAttachment[];
};

export type GuildMessageEvent = {
  id: string;
  author: GuildMessageAuthor;
  content: string;
  timestamp: string;
  channel_id: string;
  guild_id: string;
  attachments?: MessageAttachment[];
};

// --- Event names ---

/** C2C (private) message from user to bot */
export const EVENT_C2C_MESSAGE_CREATE = "C2C_MESSAGE_CREATE";
/** Group @bot message */
export const EVENT_GROUP_AT_MESSAGE_CREATE = "GROUP_AT_MESSAGE_CREATE";
/** Guild public @bot message */
export const EVENT_AT_MESSAGE_CREATE = "AT_MESSAGE_CREATE";
/** Guild private bot message (requires GUILD_MESSAGES intent) */
export const EVENT_MESSAGE_CREATE = "MESSAGE_CREATE";
/** Guild direct message */
export const EVENT_DIRECT_MESSAGE_CREATE = "DIRECT_MESSAGE_CREATE";

// --- Helpers ---

/** Extract plain text from a message content string, stripping any @mention markup. */
export function extractPlainText(content: string): string {
  // Official API content may include <@!botid> mentions; strip them
  return content.replace(/<@!\d+>/g, "").trim();
}

/** Build an Identify payload for WebSocket auth. */
export function buildIdentify(
  accessToken: string,
  intents: number,
  shard?: [number, number],
): string {
  return JSON.stringify({
    op: OpCode.Identify,
    d: {
      token: `QQBot ${accessToken}`,
      intents,
      shard: shard ?? [0, 1],
      properties: {
        $os: "linux",
        $browser: "openclaw",
        $device: "openclaw",
      },
    },
  });
}

/** Build a Heartbeat payload. */
export function buildHeartbeat(seq: number | null): string {
  return JSON.stringify({ op: OpCode.Heartbeat, d: seq });
}

/** Build a Resume payload for reconnection. */
export function buildResume(accessToken: string, sessionId: string, seq: number): string {
  return JSON.stringify({
    op: OpCode.Resume,
    d: {
      token: `QQBot ${accessToken}`,
      session_id: sessionId,
      seq,
    },
  });
}

/** Parse a gateway WebSocket message. Returns null on parse failure. */
export function parseGatewayPayload(data: string): GatewayPayload | null {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || !("op" in parsed)) {
      return null;
    }
    return parsed as unknown as GatewayPayload;
  } catch {
    return null;
  }
}

/** Determine if an event is a message event we should process. */
export function isMessageEvent(eventType: string | undefined): boolean {
  if (!eventType) {
    return false;
  }
  return (
    eventType === EVENT_C2C_MESSAGE_CREATE ||
    eventType === EVENT_GROUP_AT_MESSAGE_CREATE ||
    eventType === EVENT_AT_MESSAGE_CREATE ||
    eventType === EVENT_MESSAGE_CREATE ||
    eventType === EVENT_DIRECT_MESSAGE_CREATE
  );
}

/** Check if an event is a group/channel event (vs C2C/DM). */
export function isGroupEvent(eventType: string | undefined): boolean {
  return (
    eventType === EVENT_GROUP_AT_MESSAGE_CREATE ||
    eventType === EVENT_AT_MESSAGE_CREATE ||
    eventType === EVENT_MESSAGE_CREATE
  );
}
