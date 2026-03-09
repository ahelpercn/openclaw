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

export type WecomGroupConfig = {
  requireMention?: boolean;
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  skills?: string[];
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
};

export type WecomAccountConfig = {
  name?: string;
  enabled?: boolean;
  /** Enterprise corp ID */
  corpId?: string;
  /** App secret */
  corpSecret?: string;
  /** App agent ID */
  agentId?: number;
  /** Callback verification token */
  token?: string;
  /** Callback AES encryption key */
  encodingAESKey?: string;
  /** Webhook path (default: /wecom) */
  webhookPath?: string;
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  defaultTo?: string;
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: Array<string | number>;
  groups?: Record<string, WecomGroupConfig>;
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

export type WecomConfig = WecomAccountConfig & {
  accounts?: Record<string, WecomAccountConfig>;
};

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    wecom?: WecomConfig;
  };
};

export type WecomInboundMessage = {
  messageId: string;
  msgType: string;
  content: string;
  fromUser: string;
  toUser?: string;
  createTime: number;
  isGroup: boolean;
  groupId?: string;
  agentId?: number;
};

export type WecomProbe = BaseProbeResult<string> & {
  corpId?: string;
  agentName?: string;
  latencyMs?: number;
};
