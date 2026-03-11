import {
  buildOauthProviderAuthResult,
  emptyPluginConfigSchema,
  type OpenClawPluginApi,
  type ProviderAuthContext,
  type ProviderAuthResult,
} from "openclaw/plugin-sdk";
import { importFromKeychain, loginAnthropicOAuth, refreshAnthropicToken } from "./oauth.js";

const PROVIDER_ID = "anthropic";
const PROVIDER_LABEL = "Anthropic";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";
const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

function buildModels() {
  return [
    {
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      reasoning: false,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: { input: 0.015, output: 0.075, cacheRead: 0.0015, cacheWrite: 0.01875 },
      contextWindow: 200_000,
      maxTokens: 32_000,
    },
    {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      reasoning: false,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: { input: 0.003, output: 0.015, cacheRead: 0.0003, cacheWrite: 0.00375 },
      contextWindow: 200_000,
      maxTokens: 64_000,
    },
    {
      id: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      reasoning: false,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: { input: 0.0008, output: 0.004, cacheRead: 0.00008, cacheWrite: 0.001 },
      contextWindow: 200_000,
      maxTokens: 8_192,
    },
  ];
}

function buildConfigPatch() {
  return {
    models: {
      providers: {
        [PROVIDER_ID]: {
          baseUrl: ANTHROPIC_BASE_URL,
          apiKey: "oauth-placeholder",
          api: "anthropic-messages" as const,
          models: buildModels(),
        },
      },
    },
    agents: {
      defaults: {
        models: {
          "anthropic/claude-opus-4-6": {},
          "anthropic/claude-sonnet-4-6": { alias: "claude" },
          "anthropic/claude-haiku-4-5-20251001": {},
        },
      },
    },
  };
}

function buildResult(token: {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  subscriptionType?: string;
}): ProviderAuthResult {
  const notes = [
    `Subscription: ${token.subscriptionType || "unknown"}`,
    "Token auto-refreshes. Re-run login if refresh fails.",
  ];

  return buildOauthProviderAuthResult({
    providerId: PROVIDER_ID,
    defaultModel: DEFAULT_MODEL,
    access: token.access,
    refresh: token.refresh,
    expires: token.expires,
    email: token.email,
    configPatch: buildConfigPatch(),
    notes,
  });
}

const anthropicOAuthPlugin = {
  id: "anthropic-oauth",
  name: "Anthropic OAuth",
  description: "OAuth for Anthropic Claude models (supports Claude Max subscription import)",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      docsPath: "/providers/anthropic",
      aliases: ["anthropic", "claude"],

      // Auto-refresh expired tokens
      refreshOAuth: async (cred) => {
        if (!cred.refresh) {
          throw new Error(
            "No refresh token available. Re-run: openclaw models auth login --provider anthropic",
          );
        }
        const refreshed = await refreshAnthropicToken(cred.refresh as string);
        return {
          access: refreshed.access,
          refresh: refreshed.refresh,
          expires: refreshed.expires,
        };
      },

      // Format credential as API key for requests
      formatApiKey: (cred) => {
        if (cred.type === "oauth") {
          return (cred as { access?: string }).access || "";
        }
        if (cred.type === "api_key") {
          return (cred as { key?: string }).key || "";
        }
        return "";
      },

      auth: [
        // Method 1: Import from Claude Code Keychain (macOS only)
        {
          id: "keychain",
          label: "Import from Claude Code",
          hint: "Import OAuth token from Claude Code (macOS Keychain)",
          kind: "custom",
          run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
            const progress = ctx.prompter.progress("Reading Claude Code credentials...");

            const token = importFromKeychain();
            if (!token) {
              progress.stop("No Claude Code credentials found");
              await ctx.prompter.note(
                "Claude Code credentials not found in Keychain.\n" +
                  "Make sure Claude Code is installed and logged in (run `claude login` first).\n" +
                  "Or use the 'Anthropic OAuth' method for browser-based login.",
                "Import Failed",
              );
              throw new Error("Claude Code credentials not found in macOS Keychain");
            }

            // Check if token is expired and try refresh
            const now = Date.now();
            if (token.expires && token.expires < now) {
              progress.update("Token expired, refreshing...");
              try {
                const refreshed = await refreshAnthropicToken(token.refresh);
                token.access = refreshed.access;
                token.refresh = refreshed.refresh;
                token.expires = refreshed.expires;
                progress.update("Token refreshed successfully");
              } catch (err) {
                progress.stop("Token refresh failed");
                await ctx.prompter.note(
                  "Keychain token is expired and refresh failed.\n" +
                    "Run `claude login` to re-authenticate Claude Code first.",
                  "Refresh Failed",
                );
                throw err;
              }
            }

            const expiresDate = token.expires
              ? new Date(token.expires).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
              : "unknown";

            progress.stop("Claude Code credentials imported");

            await ctx.prompter.note(
              `Subscription: ${token.subscriptionType || "unknown"}\n` +
                `Token expires: ${expiresDate}\n` +
                `Models: Claude Opus 4.6, Sonnet 4.6, Haiku 4.5`,
              "Anthropic OAuth",
            );

            return buildResult(token);
          },
        },

        // Method 2: Full OAuth PKCE flow (cross-platform)
        {
          id: "oauth",
          label: "Anthropic OAuth",
          hint: "PKCE + browser callback (cross-platform)",
          kind: "oauth",
          run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
            const progress = ctx.prompter.progress("Starting Anthropic OAuth...");

            try {
              const token = await loginAnthropicOAuth({
                openUrl: ctx.openUrl,
                note: ctx.prompter.note,
                progress,
              });

              progress.stop("Anthropic OAuth complete");
              return buildResult(token);
            } catch (err) {
              progress.stop("Anthropic OAuth failed");
              await ctx.prompter.note(
                "If OAuth fails, try the 'Import from Claude Code' method instead.\n" +
                  "Or set ANTHROPIC_API_KEY environment variable.",
                "OAuth Failed",
              );
              throw err;
            }
          },
        },
      ],
    });
  },
};

export default anthropicOAuthPlugin;
