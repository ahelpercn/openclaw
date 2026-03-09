import { createLoggerBackedRuntime, type RuntimeEnv } from "openclaw/plugin-sdk";
import { resolveQqAccount, type ResolvedQqAccount } from "./accounts.js";
import { getAccessToken, getGatewayUrl } from "./client.js";
import { handleQqInbound } from "./inbound.js";
import {
  buildHeartbeat,
  buildIdentify,
  buildResume,
  DEFAULT_INTENTS,
  EVENT_C2C_MESSAGE_CREATE,
  EVENT_GROUP_AT_MESSAGE_CREATE,
  extractPlainText,
  isGroupEvent,
  isMessageEvent,
  OpCode,
  parseGatewayPayload,
  type C2CMessageEvent,
  type GatewayPayload,
  type GroupMessageEvent,
  type HelloData,
  type ReadyData,
} from "./qqbot-api.js";
import { getQqRuntime } from "./runtime.js";
import type { CoreConfig, QqInboundMessage } from "./types.js";

export type QqMonitorOptions = {
  accountId: string;
  config: CoreConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  statusSink?: (patch: Record<string, unknown>) => void;
};

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60_000;

/** Start monitoring QQ messages via Official Bot API WebSocket gateway. */
export async function monitorQqProvider(opts: QqMonitorOptions): Promise<{ stop: () => void }> {
  const { accountId, config, abortSignal, statusSink } = opts;
  const core = getQqRuntime();
  const account = resolveQqAccount({ cfg: config, accountId });

  if (!account.configured) {
    throw new Error(
      `QQ is not configured for account "${accountId}" (need appId + appSecret in channels.qq).`,
    );
  }

  const runtime: RuntimeEnv =
    opts.runtime ??
    createLoggerBackedRuntime({
      logger: core.logging.getChildLogger(),
      exitError: () => new Error("Runtime exit not available"),
    });

  let reconnectDelay = RECONNECT_BASE_MS;
  let stopped = false;
  let currentWs: WebSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lastSeq: number | null = null;
  let sessionId: string | null = null;
  let botId: string | null = null;

  async function connect() {
    if (stopped || abortSignal?.aborted) {
      return;
    }

    statusSink?.({ running: false });

    try {
      // Get fresh access token and gateway URL
      const token = await getAccessToken(account.appId, account.appSecret);
      const gatewayUrl = await getGatewayUrl(account.appId, account.appSecret);

      runtime.log(`[${accountId}] connecting to gateway ${gatewayUrl}`);

      const ws = new WebSocket(gatewayUrl);
      currentWs = ws;

      ws.addEventListener("open", () => {
        runtime.log(`[${accountId}] gateway WebSocket connected`);
        reconnectDelay = RECONNECT_BASE_MS;
      });

      ws.addEventListener("message", (event) => {
        const data = typeof event.data === "string" ? event.data : String(event.data);
        const payload = parseGatewayPayload(data);
        if (!payload) {
          return;
        }
        handleGatewayPayload(ws, payload, token);
      });

      ws.addEventListener("close", (event) => {
        runtime.log(`[${accountId}] gateway closed (code=${event.code})`);
        cleanup();
        statusSink?.({ running: false, lastStopAt: Date.now() });
        scheduleReconnect();
      });

      ws.addEventListener("error", (event) => {
        const errMsg = event instanceof ErrorEvent ? event.message : "WebSocket error";
        runtime.error(`[${accountId}] gateway error: ${errMsg}`);
        statusSink?.({ lastError: errMsg });
      });
    } catch (err) {
      runtime.error(`[${accountId}] connection failed: ${String(err)}`);
      statusSink?.({ lastError: String(err) });
      scheduleReconnect();
    }
  }

  function handleGatewayPayload(ws: WebSocket, payload: GatewayPayload, token: string) {
    // Track sequence number for heartbeats and resume
    if (payload.s !== undefined && payload.s !== null) {
      lastSeq = payload.s;
    }

    switch (payload.op) {
      case OpCode.Hello: {
        const hello = payload.d as HelloData;
        runtime.log(
          `[${accountId}] received Hello, heartbeat_interval=${hello.heartbeat_interval}ms`,
        );
        startHeartbeat(ws, hello.heartbeat_interval);

        // Send Identify or Resume
        if (sessionId && lastSeq !== null) {
          runtime.log(`[${accountId}] resuming session ${sessionId}`);
          ws.send(buildResume(token, sessionId, lastSeq));
        } else {
          runtime.log(`[${accountId}] identifying with intents=${DEFAULT_INTENTS}`);
          ws.send(buildIdentify(token, DEFAULT_INTENTS));
        }
        break;
      }

      case OpCode.Dispatch: {
        // t=READY: auth success
        if (payload.t === "READY") {
          const ready = payload.d as ReadyData;
          sessionId = ready.session_id;
          botId = ready.user.id;
          runtime.log(`[${accountId}] ready: botId=${botId}, session=${sessionId}`);
          statusSink?.({ running: true, lastStartAt: Date.now(), lastError: null });
        }

        // t=RESUMED: reconnect success
        if (payload.t === "RESUMED") {
          runtime.log(`[${accountId}] resumed successfully`);
          statusSink?.({ running: true, lastStartAt: Date.now(), lastError: null });
        }

        // Handle message events
        if (isMessageEvent(payload.t)) {
          handleMessageDispatch(payload, account, config, runtime, statusSink);
        }
        break;
      }

      case OpCode.HeartbeatAck:
        // Normal heartbeat acknowledgement, no action needed
        break;

      case OpCode.Reconnect:
        runtime.log(`[${accountId}] server requested reconnect`);
        ws.close(4000, "server requested reconnect");
        break;

      case OpCode.InvalidSession: {
        runtime.log(`[${accountId}] invalid session, clearing state`);
        // Clear session so next connect does a fresh Identify
        sessionId = null;
        lastSeq = null;
        ws.close(4000, "invalid session");
        break;
      }

      default:
        break;
    }
  }

  function startHeartbeat(ws: WebSocket, intervalMs: number) {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buildHeartbeat(lastSeq));
      }
    }, intervalMs);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function cleanup() {
    stopHeartbeat();
    currentWs = null;
  }

  function scheduleReconnect() {
    if (stopped || abortSignal?.aborted) {
      return;
    }
    runtime.log(`[${accountId}] reconnecting in ${reconnectDelay}ms`);
    setTimeout(() => {
      connect().catch((err) => {
        runtime.error(`[${accountId}] reconnect error: ${String(err)}`);
      });
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  function stop() {
    stopped = true;
    cleanup();
    if (currentWs && currentWs.readyState !== WebSocket.CLOSED) {
      currentWs.close();
    }
    currentWs = null;
    statusSink?.({ running: false, lastStopAt: Date.now() });
  }

  abortSignal?.addEventListener("abort", stop, { once: true });
  await connect();

  return { stop };
}

function handleMessageDispatch(
  payload: GatewayPayload,
  account: ResolvedQqAccount,
  config: CoreConfig,
  runtime: RuntimeEnv,
  statusSink?: (patch: Record<string, unknown>) => void,
): void {
  const core = getQqRuntime();
  const eventType = payload.t ?? "";
  const eventData = payload.d as Record<string, unknown>;

  if (!eventData || typeof eventData !== "object") {
    return;
  }

  const isGroup = isGroupEvent(eventType);
  const rawContent = (eventData.content as string) ?? "";
  const text = extractPlainText(rawContent);
  if (!text.trim()) {
    return;
  }

  // Extract sender and target based on event type
  let senderId: string;
  let target: string;
  const messageId = (eventData.id as string) ?? "";
  const timestamp = eventData.timestamp
    ? new Date(eventData.timestamp as string).getTime()
    : Date.now();

  if (eventType === EVENT_C2C_MESSAGE_CREATE) {
    // Private message
    const author = eventData.author as C2CMessageEvent["author"];
    senderId = author.user_openid;
    target = senderId;
  } else if (eventType === EVENT_GROUP_AT_MESSAGE_CREATE) {
    // Group @bot message
    const author = eventData.author as GroupMessageEvent["author"];
    senderId = author.member_openid;
    target = (eventData.group_openid as string) ?? "";
  } else {
    // Guild messages — use guild author id
    const author = eventData.author as {
      id?: string;
      user_openid?: string;
      member_openid?: string;
    };
    senderId = author.id ?? author.user_openid ?? author.member_openid ?? "unknown";
    target = (eventData.channel_id as string) ?? (eventData.guild_id as string) ?? "";
  }

  const message: QqInboundMessage = {
    messageId,
    target,
    senderId,
    senderNickname: undefined,
    text,
    timestamp,
    isGroup,
  };

  core.channel.activity.record({
    channel: "qq",
    accountId: account.accountId,
    direction: "inbound",
  });
  statusSink?.({ lastInboundAt: message.timestamp });

  handleQqInbound({
    message,
    account,
    config,
    runtime,
    statusSink: statusSink as
      | ((patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void)
      | undefined,
  }).catch((err) => {
    runtime.error(`[${account.accountId}] inbound error: ${String(err)}`);
  });
}
