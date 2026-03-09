import { createLoggerBackedRuntime, type RuntimeEnv } from "openclaw/plugin-sdk";
import { resolveWecomAccount } from "./accounts.js";
import { decryptWecomMessage, extractXmlField, verifyWecomCallback } from "./crypto.js";
import { handleWecomInbound } from "./inbound.js";
import { getWecomRuntime } from "./runtime.js";
import type { CoreConfig, WecomInboundMessage } from "./types.js";

export type WecomMonitorOptions = {
  accountId: string;
  config: CoreConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  statusSink?: (patch: Record<string, unknown>) => void;
};

/**
 * Start monitoring WeCom messages via HTTP webhook callback.
 * Registers an HTTP handler for the configured webhook path.
 */
export async function monitorWecomProvider(
  opts: WecomMonitorOptions,
): Promise<{ stop: () => void }> {
  const { accountId, config, statusSink } = opts;
  const core = getWecomRuntime();
  const account = resolveWecomAccount({ cfg: config, accountId });

  if (!account.configured) {
    throw new Error(
      `WeCom is not configured for account "${accountId}" (need corpId, corpSecret, agentId).`,
    );
  }

  const runtime: RuntimeEnv =
    opts.runtime ??
    createLoggerBackedRuntime({
      logger: core.logging.getChildLogger(),
      exitError: () => new Error("Runtime exit not available"),
    });

  const webhookPath = account.webhookPath || "/wecom";

  runtime.log(`[${accountId}] registering webhook at ${webhookPath}`);
  statusSink?.({ running: true, lastStartAt: Date.now(), lastError: null });

  // Register HTTP route for WeCom callbacks
  const handler = async (req: {
    method: string;
    url: string;
    body?: string;
    query?: Record<string, string>;
  }): Promise<{ status: number; body: string; headers?: Record<string, string> }> => {
    const query = req.query ?? {};
    const msgSignature = query.msg_signature ?? "";
    const timestamp = query.timestamp ?? "";
    const nonce = query.nonce ?? "";

    // GET: URL verification (WeCom callback config step)
    if (req.method === "GET") {
      const echostr = query.echostr ?? "";
      if (!echostr || !account.token || !account.encodingAESKey) {
        return { status: 400, body: "missing verification params" };
      }

      const valid = verifyWecomCallback({
        token: account.token,
        timestamp,
        nonce,
        encrypted: echostr,
        signature: msgSignature,
      });
      if (!valid) {
        runtime.error(`[${accountId}] callback verification failed`);
        return { status: 403, body: "signature mismatch" };
      }

      const { message } = decryptWecomMessage(account.encodingAESKey, echostr);
      return { status: 200, body: message };
    }

    // POST: incoming message
    if (req.method === "POST") {
      const xml = req.body ?? "";
      const encrypted = extractXmlField(xml, "Encrypt");
      if (!encrypted) {
        return { status: 400, body: "missing Encrypt field" };
      }

      if (account.token) {
        const valid = verifyWecomCallback({
          token: account.token,
          timestamp,
          nonce,
          encrypted,
          signature: msgSignature,
        });
        if (!valid) {
          runtime.error(`[${accountId}] message signature verification failed`);
          return { status: 403, body: "signature mismatch" };
        }
      }

      if (!account.encodingAESKey) {
        return { status: 500, body: "encodingAESKey not configured" };
      }

      try {
        const { message: decrypted } = decryptWecomMessage(account.encodingAESKey, encrypted);

        // Parse the decrypted XML message
        const msgType = extractXmlField(decrypted, "MsgType") ?? "text";
        const content = extractXmlField(decrypted, "Content") ?? "";
        const fromUser = extractXmlField(decrypted, "FromUserName") ?? "";
        const toUser = extractXmlField(decrypted, "ToUserName");
        const createTimeStr = extractXmlField(decrypted, "CreateTime") ?? "0";
        const msgId = extractXmlField(decrypted, "MsgId") ?? `wecom_${Date.now()}`;
        const agentIdStr = extractXmlField(decrypted, "AgentID");

        if (msgType !== "text" || !content.trim() || !fromUser) {
          return { status: 200, body: "success" };
        }

        const inbound: WecomInboundMessage = {
          messageId: msgId,
          msgType,
          content: content.trim(),
          fromUser,
          toUser: toUser || undefined,
          createTime: Number.parseInt(createTimeStr, 10) * 1000,
          isGroup: false, // WeCom app messages are typically 1:1 with the bot
          agentId: agentIdStr ? Number.parseInt(agentIdStr, 10) : undefined,
        };

        core.channel.activity.record({
          channel: "wecom",
          accountId: account.accountId,
          direction: "inbound",
        });
        statusSink?.({ lastInboundAt: inbound.createTime });

        // Handle asynchronously so the webhook returns quickly
        handleWecomInbound({
          message: inbound,
          account,
          config,
          runtime,
          statusSink: statusSink as
            | ((patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void)
            | undefined,
        }).catch((err) => {
          runtime.error(`[${accountId}] inbound error: ${String(err)}`);
        });
      } catch (err) {
        runtime.error(`[${accountId}] decrypt error: ${String(err)}`);
        return { status: 500, body: "decrypt error" };
      }

      return { status: 200, body: "success" };
    }

    return { status: 405, body: "method not allowed" };
  };

  // Store handler reference for cleanup
  const routeId = `wecom-${accountId}`;

  // The actual HTTP handler registration depends on the gateway's HTTP server.
  // Store the handler so the channel's gateway adapter can wire it.
  (monitorWecomProvider as unknown as Record<string, unknown>)[`_handler_${routeId}`] = handler;

  function stop() {
    statusSink?.({ running: false, lastStopAt: Date.now() });
    delete (monitorWecomProvider as unknown as Record<string, unknown>)[`_handler_${routeId}`];
  }

  return { stop };
}
