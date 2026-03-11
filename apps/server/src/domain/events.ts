import { z } from 'zod';

export const SessionStatusSchema = z.enum([
  'running',
  'stalled',
  'failed',
  'completed',
  'idle',
  'unknown',
]);

export const ActionEventKindSchema = z.enum([
  'user',
  'think',
  'toolCall',
  'toolResult',
  'reply',
  'assistantError',
  'assistantText',
  'system',
]);

export const EventSourceSchema = z.enum(['session_jsonl', 'raw_stream', 'system']);

export const SessionSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: SessionStatusSchema,
  startedAt: z.number().int().nullable(),
  updatedAt: z.number().int(),
  lastActionSummary: z.string().nullable(),
  metadata: z.unknown().nullable(),
});

export const ActionHistoryItemSchema = z.object({
  eventId: z.string(),
  sessionId: z.string(),
  sequence: z.number().int().nonnegative(),
  kind: ActionEventKindSchema,
  status: SessionStatusSchema.nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  startedAt: z.number().int().nullable(),
  endedAt: z.number().int().nullable(),
  cursor: z.number().int().nullable(),
  payload: z.unknown(),
});

export const ChainSummarySchema = z.object({
  user: z.number().int().nonnegative(),
  think: z.number().int().nonnegative(),
  toolCall: z.number().int().nonnegative(),
  toolResult: z.number().int().nonnegative(),
  reply: z.number().int().nonnegative(),
  assistantError: z.number().int().nonnegative(),
  assistantText: z.number().int().nonnegative(),
  system: z.number().int().nonnegative(),
  tools: z.array(z.string()),
});

export const ChainStepSchema = z.object({
  eventId: z.string(),
  sequence: z.number().int().positive(),
  kind: ActionEventKindSchema,
  label: z.string(),
  title: z.string(),
  timestamp: z.number().int().nullable(),
  body: z.string(),
  meta: z.string(),
  isError: z.boolean(),
  raw: z.unknown().nullable(),
});

export const TerminalMessageItemSchema = z.object({
  key: z.string(),
  eventId: z.string(),
  ordinal: z.number().int().positive(),
  timestamp: z.number().int().nullable(),
  rowIndex: z.number().int().nullable(),
  preview: z.string(),
  fullText: z.string(),
  pending: z.boolean(),
  startSequence: z.number().int().positive(),
  endSequence: z.number().int().positive(),
  stepCount: z.number().int().nonnegative(),
  triggerUserText: z.string().nullable(),
  summary: ChainSummarySchema,
  steps: z.array(ChainStepSchema),
});

export const RawDebugEventSchema = z.object({
  streamCursor: z.number().int().nonnegative(),
  eventId: z.string(),
  sessionId: z.string().nullable(),
  runId: z.string().nullable(),
  source: EventSourceSchema,
  kind: z.string(),
  eventTs: z.number().int().nonnegative(),
  payload: z.unknown(),
});

export const SessionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ActionHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const ActionHistoryParamsSchema = z.object({
  sessionId: z.string().min(1),
});

export const StreamQuerySchema = z.object({
  cursor: z.coerce.number().int().nonnegative().optional(),
  sessionId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type ActionHistoryItem = z.infer<typeof ActionHistoryItemSchema>;
export type RawDebugEvent = z.infer<typeof RawDebugEventSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type ActionEventKind = z.infer<typeof ActionEventKindSchema>;
export type EventSource = z.infer<typeof EventSourceSchema>;
export type ChainSummary = z.infer<typeof ChainSummarySchema>;
export type ChainStep = z.infer<typeof ChainStepSchema>;
export type TerminalMessageItem = z.infer<typeof TerminalMessageItemSchema>;
