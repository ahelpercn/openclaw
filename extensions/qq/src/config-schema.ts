import {
  BlockStreamingCoalesceSchema,
  DmConfigSchema,
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
  ReplyRuntimeConfigSchemaShape,
  ToolPolicySchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk";
import { z } from "zod";

const QqGroupSchema = z
  .object({
    requireMention: z.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: z.record(z.string(), ToolPolicySchema).optional(),
    skills: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    systemPrompt: z.string().optional(),
  })
  .strict();

export const QqAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    appId: z.string().optional(),
    appSecret: z.string().optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    defaultTo: z.string().optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groups: z.record(z.string(), QqGroupSchema.optional()).optional(),
    markdown: MarkdownConfigSchema,
    ...ReplyRuntimeConfigSchemaShape,
  })
  .strict();

export const QqAccountSchema = QqAccountSchemaBase.superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.qq.dmPolicy="open" requires channels.qq.allowFrom to include "*"',
  });
});

export const QqConfigSchema = QqAccountSchemaBase.extend({
  accounts: z.record(z.string(), QqAccountSchema.optional()).optional(),
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.qq.dmPolicy="open" requires channels.qq.allowFrom to include "*"',
  });
});
