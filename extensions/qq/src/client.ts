/**
 * QQ Official Bot API REST client.
 * Handles access token lifecycle and API requests.
 * @see https://bot.q.qq.com/wiki/develop/api-v2/
 */

const TOKEN_ENDPOINT = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE = "https://api.sgroup.qq.com";

// Buffer before expiry to refresh token (5 minutes)
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

// Per-appId token cache
const tokenCache = new Map<string, CachedToken>();

/** Fetch or return cached access token. */
export async function getAccessToken(appId: string, appSecret: string): Promise<string> {
  const cached = tokenCache.get(appId);
  if (cached && cached.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return cached.accessToken;
  }

  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret: appSecret }),
  });

  if (!resp.ok) {
    throw new Error(`QQ Bot token request failed: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: string | number };
  const expiresIn = typeof data.expires_in === "string" ? Number(data.expires_in) : data.expires_in;

  tokenCache.set(appId, {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  return data.access_token;
}

/** Clear cached token for an appId. */
export function clearTokenCache(appId: string): void {
  tokenCache.delete(appId);
}

/** Make an authenticated API request to the QQ Bot API. */
export async function qqApiRequest<T = unknown>(params: {
  appId: string;
  appSecret: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}): Promise<T> {
  const token = await getAccessToken(params.appId, params.appSecret);
  const url = `${API_BASE}${params.path}`;

  const resp = await fetch(url, {
    method: params.method,
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`QQ Bot API ${params.method} ${params.path}: ${resp.status} ${text}`);
  }

  // DELETE responses may have empty body
  if (resp.status === 204 || resp.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return (await resp.json()) as T;
}

/** Get WebSocket gateway URL. */
export async function getGatewayUrl(appId: string, appSecret: string): Promise<string> {
  const data = await qqApiRequest<{ url: string }>({
    appId,
    appSecret,
    method: "GET",
    path: "/gateway",
  });
  return data.url;
}

/** Send a text message to a user (C2C / private). */
export async function sendC2CMessage(params: {
  appId: string;
  appSecret: string;
  openid: string;
  content: string;
  msgId?: string;
  msgSeq?: number;
}): Promise<{ id: string; timestamp: number }> {
  return qqApiRequest({
    appId: params.appId,
    appSecret: params.appSecret,
    method: "POST",
    path: `/v2/users/${params.openid}/messages`,
    body: {
      content: params.content,
      msg_type: 0,
      ...(params.msgId ? { msg_id: params.msgId } : {}),
      ...(params.msgSeq ? { msg_seq: params.msgSeq } : {}),
    },
  });
}

/** Send a text message to a group. */
export async function sendGroupMessage(params: {
  appId: string;
  appSecret: string;
  groupOpenid: string;
  content: string;
  msgId?: string;
  msgSeq?: number;
}): Promise<{ id: string; timestamp: number }> {
  return qqApiRequest({
    appId: params.appId,
    appSecret: params.appSecret,
    method: "POST",
    path: `/v2/groups/${params.groupOpenid}/messages`,
    body: {
      content: params.content,
      msg_type: 0,
      ...(params.msgId ? { msg_id: params.msgId } : {}),
      ...(params.msgSeq ? { msg_seq: params.msgSeq } : {}),
    },
  });
}

/** Get bot info via /users/@me. */
export async function getBotInfo(
  appId: string,
  appSecret: string,
): Promise<{ id: string; username: string; bot: boolean }> {
  return qqApiRequest({
    appId,
    appSecret,
    method: "GET",
    path: "/users/@me",
  });
}
