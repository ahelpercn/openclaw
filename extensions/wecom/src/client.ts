/**
 * WeCom REST API client with auto-refreshing access token.
 */

const WECOM_API_BASE = "https://qyapi.weixin.qq.com/cgi-bin";

type TokenCache = {
  token: string;
  expiresAt: number;
};

const tokenCaches = new Map<string, TokenCache>();

/** Get or refresh access token for a corp/secret pair. */
async function getAccessToken(corpId: string, corpSecret: string): Promise<string> {
  const cacheKey = `${corpId}:${corpSecret}`;
  const cached = tokenCaches.get(cacheKey);
  // Refresh 5 minutes before expiry
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cached.token;
  }

  const url = `${WECOM_API_BASE}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`WeCom gettoken failed: ${resp.status} ${resp.statusText}`);
  }
  const data = (await resp.json()) as {
    errcode: number;
    errmsg: string;
    access_token?: string;
    expires_in?: number;
  };
  if (data.errcode !== 0 || !data.access_token) {
    throw new Error(`WeCom gettoken error: ${data.errcode} ${data.errmsg}`);
  }

  const token = data.access_token;
  const expiresIn = data.expires_in ?? 7200;
  tokenCaches.set(cacheKey, {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return token;
}

export type WecomSendResult = {
  errcode: number;
  errmsg: string;
  invaliduser?: string;
};

/** Send a text message via WeCom API. */
export async function sendWecomText(params: {
  corpId: string;
  corpSecret: string;
  agentId: number;
  toUser: string;
  content: string;
}): Promise<WecomSendResult> {
  const token = await getAccessToken(params.corpId, params.corpSecret);
  const url = `${WECOM_API_BASE}/message/send?access_token=${encodeURIComponent(token)}`;
  const body = {
    touser: params.toUser,
    msgtype: "text",
    agentid: params.agentId,
    text: { content: params.content },
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`WeCom send failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json() as Promise<WecomSendResult>;
}

/** Send a markdown message via WeCom API. */
export async function sendWecomMarkdown(params: {
  corpId: string;
  corpSecret: string;
  agentId: number;
  toUser: string;
  content: string;
}): Promise<WecomSendResult> {
  const token = await getAccessToken(params.corpId, params.corpSecret);
  const url = `${WECOM_API_BASE}/message/send?access_token=${encodeURIComponent(token)}`;
  const body = {
    touser: params.toUser,
    msgtype: "markdown",
    agentid: params.agentId,
    markdown: { content: params.content },
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`WeCom send markdown failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json() as Promise<WecomSendResult>;
}

/** Get agent info (for probe). */
export async function getWecomAgentInfo(params: {
  corpId: string;
  corpSecret: string;
  agentId: number;
}): Promise<{ errcode: number; errmsg: string; name?: string }> {
  const token = await getAccessToken(params.corpId, params.corpSecret);
  const url = `${WECOM_API_BASE}/agent/get?access_token=${encodeURIComponent(token)}&agentid=${params.agentId}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`WeCom agent/get failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json() as Promise<{ errcode: number; errmsg: string; name?: string }>;
}

/** Invalidate cached token (e.g. on 401). */
export function invalidateWecomToken(corpId: string, corpSecret: string): void {
  tokenCaches.delete(`${corpId}:${corpSecret}`);
}
