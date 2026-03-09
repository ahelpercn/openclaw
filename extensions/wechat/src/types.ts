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

export type WechatGroupConfig = {
  requireMention?: boolean;
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  skills?: string[];
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
};

export type WechatAccountConfig = {
  name?: string;
  enabled?: boolean;
  /** Wechaty puppet name (default: wechaty-puppet-wechat4) */
  puppet?: string;
  /** Puppet-specific options (e.g. padlocal token) */
  puppetOptions?: Record<string, unknown>;
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  defaultTo?: string;
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: Array<string | number>;
  groups?: Record<string, WechatGroupConfig>;
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

export type WechatConfig = WechatAccountConfig & {
  accounts?: Record<string, WechatAccountConfig>;
};

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    wechat?: WechatConfig;
  };
};

export type WechatInboundMessage = {
  messageId: string;
  text: string;
  senderId: string;
  senderName?: string;
  roomId?: string;
  roomTopic?: string;
  isGroup: boolean;
  timestamp: number;
  /** Conversation target: room topic for groups, sender ID for DMs */
  target: string;
};

export type WechatProbe = BaseProbeResult<string> & {
  selfName?: string;
  selfId?: string;
  puppet?: string;
  latencyMs?: number;
};
