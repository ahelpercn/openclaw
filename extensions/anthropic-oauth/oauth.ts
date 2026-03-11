import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generatePkceVerifierChallenge, toFormUrlEncoded } from "openclaw/plugin-sdk";

// Anthropic OAuth constants (from Claude Code)
const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_AUTH_URL = "https://console.anthropic.com/oauth/authorize";
const ANTHROPIC_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const ANTHROPIC_SCOPES = "user:inference user:profile";
const CALLBACK_PORT = 18976;
const CALLBACK_PATH = "/oauth/callback";
const KEYCHAIN_SERVICE = "Claude Code-credentials";

export type AnthropicOAuthToken = {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  subscriptionType?: string;
};

/**
 * Import OAuth credentials from Claude Code's macOS Keychain entry.
 * This is the simplest path for users who already have Claude Code logged in.
 */
export function importFromKeychain(username?: string): AnthropicOAuthToken | null {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const user = username || process.env.USER || "jack";
    const raw = execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${user}" -w 2>/dev/null`,
      { encoding: "utf-8", timeout: 5000 },
    ).trim();

    if (!raw) return null;

    const creds = JSON.parse(raw) as {
      claudeAiOauth?: {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
        subscriptionType?: string;
      };
    };

    const oauth = creds.claudeAiOauth;
    if (!oauth?.accessToken || !oauth?.refreshToken) {
      return null;
    }

    return {
      access: oauth.accessToken,
      refresh: oauth.refreshToken,
      expires: oauth.expiresAt ?? 0,
      subscriptionType: oauth.subscriptionType,
    };
  } catch {
    return null;
  }
}

/**
 * Refresh an Anthropic OAuth token using the refresh token.
 */
export async function refreshAnthropicToken(refreshToken: string): Promise<AnthropicOAuthToken> {
  const response = await fetch(ANTHROPIC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: ANTHROPIC_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    access: data.access_token,
    refresh: data.refresh_token || refreshToken,
    expires: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Full OAuth PKCE flow with local HTTP callback server.
 * Opens browser for user to authorize, then exchanges code for token.
 */
export async function loginAnthropicOAuth(params: {
  openUrl: (url: string) => Promise<void>;
  note: (message: string, title?: string) => Promise<void>;
  progress: { update: (message: string) => void; stop: (message?: string) => void };
}): Promise<AnthropicOAuthToken> {
  const { verifier, challenge } = generatePkceVerifierChallenge();
  const state = randomUUID();
  const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

  const authUrl = new URL(ANTHROPIC_AUTH_URL);
  authUrl.searchParams.set("client_id", ANTHROPIC_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", ANTHROPIC_SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  // Start local callback server
  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth timed out after 120 seconds"));
    }, 120_000);

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const receivedState = url.searchParams.get("state");
      const receivedCode = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Authorization failed</h2><p>You can close this tab.</p>");
        clearTimeout(timeout);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (receivedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>State mismatch</h2><p>Please try again.</p>");
        return;
      }

      if (!receivedCode) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Missing code</h2><p>Please try again.</p>");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<h2>Authorization successful!</h2><p>You can close this tab and return to the terminal.</p>",
      );
      clearTimeout(timeout);
      server.close();
      resolve(receivedCode);
    });

    server.listen(CALLBACK_PORT, "127.0.0.1", async () => {
      params.progress.update("Waiting for browser authorization...");
      try {
        await params.openUrl(authUrl.toString());
      } catch {
        // Browser open failed; user must copy URL manually
      }
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start OAuth callback server: ${err.message}`));
    });
  });

  // Exchange authorization code for tokens
  params.progress.update("Exchanging authorization code...");

  const tokenResponse = await fetch(ANTHROPIC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      client_id: ANTHROPIC_CLIENT_ID,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`Token exchange failed (${tokenResponse.status}): ${text}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    access: tokenData.access_token,
    refresh: tokenData.refresh_token,
    expires: Date.now() + tokenData.expires_in * 1000,
  };
}
