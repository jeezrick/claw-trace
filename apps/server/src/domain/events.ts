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
