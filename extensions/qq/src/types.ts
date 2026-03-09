import type { BaseProbeResult } from "openclaw/plugin-sdk";
import type {
  BlockStreamingCoalesceConfig,
  DmConfig,
  DmPolicy,
  GroupPolicy,
  GroupToolPolicyBySenderConfig,
  GroupToolPolicyConfig,
  MarkdownConfig,
  OpenClawConfig,
} from "openclaw/plugin-sdk";

export type QqGroupConfig = {
  requireMention?: boolean;
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  skills?: string[];
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
};

export type QqAccountConfig = {
  name?: string;
  enabled?: boolean;
  /** QQ Bot AppID from open platform (required) */
  appId?: string;
  /** QQ Bot AppSecret / ClientSecret from open platform (required) */
  appSecret?: string;
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  defaultTo?: string;
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: Array<string | number>;
  groups?: Record<string, QqGroupConfig>;
  markdown?: MarkdownConfig;
  historyLimit?: number;
  dmHistoryLimit?: number;
  dms?: Record<string, DmConfig>;
  textChunkLimit?: number;
  chunkMode?: "length" | "newline";
  blockStreaming?: boolean;
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  responsePrefix?: string;
  mediaMaxMb?: number;
};

export type QqConfig = QqAccountConfig & {
  accounts?: Record<string, QqAccountConfig>;
};

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    qq?: QqConfig;
  };
};

export type QqInboundMessage = {
  messageId: string;
  /** Conversation target: group openid for groups, user openid for DMs */
  target: string;
  /** Sender openid (user_openid for C2C, member_openid for groups) */
  senderId: string;
  senderNickname?: string;
  text: string;
  timestamp: number;
  isGroup: boolean;
};

export type QqProbe = BaseProbeResult<string> & {
  botId?: string;
  botName?: string;
  latencyMs?: number;
};
