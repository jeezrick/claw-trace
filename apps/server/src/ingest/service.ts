import crypto from 'node:crypto';
import EventEmitter from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

import type { AppConfig } from '../config';
import type { ActionHistoryItem, SessionStatus, SessionSummary } from '../domain/events';
import type {
  ActionWriteInput,
  EventStore,
  RawStreamWriteInput,
  SessionWriteInput,
} from '../store/event-store';

const RAW_STREAM_CURSOR_NAME = 'raw_stream_file';
const MAX_TEXT_PAYLOAD_CHARS = 12_000;
const MAX_SUMMARY_CHARS = 220;

type JsonRecord = Record<string, unknown>;

export type SessionIndexEntry = {
  sessionKey: string;
  sessionId: string;
  sessionFilePath: string;
  updatedAt: number;
  title: string;
  provider: string;
  chatType: string;
  deliveryTarget: string;
  raw: JsonRecord;
};

type SessionFingerprint = {
  status: string;
  updatedAt: number;
  actionCount: number;
};

type SessionFileCache = {
  mtime: number;
  size: number;
  indexUpdatedAt: number;
  sessions: SessionWriteInput[];
  actions: ActionWriteInput[];
};

export type IngestNotifications = EventEmitter & {
  on(event: 'session_changed', listener: (payload: { change: 'added' | 'updated' | 'removed'; session?: SessionSummary; sessionId?: string }) => void): IngestNotifications;
  on(event: 'action_changed', listener: (payload: { sessionId: string; actions: ActionHistoryItem[] }) => void): IngestNotifications;
  emit(event: 'session_changed', payload: { change: 'added' | 'updated' | 'removed'; session?: SessionSummary; sessionId?: string }): boolean;
  emit(event: 'action_changed', payload: { sessionId: string; actions: ActionHistoryItem[] }): boolean;
};

export type IngestState = {
  initialLoadCompleted: boolean;
  lastSessionSyncAt: number | null;
  lastRawSyncAt: number | null;
  sessionSyncError: string | null;
  rawSyncError: string | null;
  sessionsIndexFile: string;
  rawStreamFile: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hashValue(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

function previewText(value: string, maxLength = MAX_SUMMARY_CHARS): string {
  return truncateText(value.replace(/\s+/g, ' '), maxLength);
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return truncateText(value, MAX_TEXT_PAYLOAD_CHARS);
}

function compactPayload<T>(value: T): T | string {
  if (typeof value === 'string') {
    return truncateText(value, MAX_TEXT_PAYLOAD_CHARS);
  }

  return value;
}

function stringifyValue(value: unknown): string {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function stripSpeakerPrefix(value: string): string {
  const match = value.match(/^[^:\n]{1,120}:\s*([\s\S]*)$/);
  return match ? match[1].trim() : value.trim();
}

function normalizeUserText(value: string): string {
  const raw = value.trim();

  if (!raw) {
    return '';
  }

  const marker = raw.lastIndexOf('[message_id:');
  if (marker >= 0) {
    const lineBreakIndex = raw.indexOf('\n', marker);
    const afterMarker = raw.slice(lineBreakIndex >= 0 ? lineBreakIndex + 1 : marker).trim();

    if (afterMarker) {
      const firstLineBreak = afterMarker.indexOf('\n');

      if (firstLineBreak >= 0) {
        const firstLine = stripSpeakerPrefix(afterMarker.slice(0, firstLineBreak));
        const rest = afterMarker.slice(firstLineBreak + 1).trim();
        return `${firstLine}${rest ? `\n${rest}` : ''}`.trim();
      }

      return stripSpeakerPrefix(afterMarker);
    }
  }

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 0) {
    return stripSpeakerPrefix(lines[lines.length - 1].replace(/^\[[^\]]+\]\s*/, '').trim());
  }

  return stripSpeakerPrefix(raw.replace(/^\[[^\]]+\]\s*/, '').trim());
}

function cleanAssistantText(value: string): string {
  return value.replace(/\[\[reply_to_current\]\]\s*/g, '').trim();
}

function detectToolResultError(message: JsonRecord): boolean {
  if (message.isError === true) {
    return true;
  }

  const details = isRecord(message.details) ? message.details : null;
  if (details?.status === 'error') {
    return true;
  }

  return /"status"\s*:\s*"error"/i.test(extractTextContent(message.content));
}

function bestEffortActionStatus(
  kind: ActionWriteInput['kind'],
  isError = false
): SessionStatus | null {
  if (kind === 'reply') {
    return 'completed';
  }

  if (kind === 'assistantError' || isError) {
    return 'failed';
  }

  if (kind === 'user' || kind === 'think' || kind === 'toolCall' || kind === 'assistantText') {
    return 'running';
  }

  return null;
}

function summarizeAction(action: ActionWriteInput | null): string | null {
  if (!action) {
    return null;
  }

  switch (action.kind) {
    case 'user':
      return `User: ${action.summary ?? action.title}`;
    case 'think':
      return `Thinking: ${action.summary ?? action.title}`;
    case 'toolCall':
      return `Tool call: ${action.title}`;
    case 'toolResult':
      return `Tool result: ${action.title}`;
    case 'reply':
      return `Reply: ${action.summary ?? action.title}`;
    case 'assistantError':
      return `Error: ${action.summary ?? action.title}`;
    case 'assistantText':
      return `Assistant: ${action.summary ?? action.title}`;
    default:
      return action.summary ?? action.title;
  }
}

function deriveSessionStatus(
  actions: ActionWriteInput[],
  sourceUpdatedAt: number,
  config: AppConfig,
  raw: JsonRecord
): SessionStatus {
  const lastAction = actions[actions.length - 1] ?? null;
  const referenceTs = lastAction?.endedAt ?? lastAction?.startedAt ?? sourceUpdatedAt;
  const ageMs = Date.now() - referenceTs;

  if (raw.abortedLastRun === true || lastAction?.kind === 'assistantError') {
    return 'failed';
  }

  if (!lastAction) {
    return 'idle';
  }

  if (lastAction.kind === 'reply') {
    return 'completed';
  }

  if (lastAction.kind === 'user') {
    return ageMs > config.sessionStallMs ? 'idle' : 'running';
  }

  if (ageMs > config.sessionStallMs) {
    return 'stalled';
  }

  return 'running';
}

function toTitle(entry: JsonRecord, sessionKey: string, sessionId: string): string {
  const origin = isRecord(entry.origin) ? entry.origin : null;
  const deliveryContext = isRecord(entry.deliveryContext) ? entry.deliveryContext : null;

  return (
    (typeof origin?.label === 'string' && origin.label) ||
    (typeof deliveryContext?.to === 'string' && deliveryContext.to) ||
    (typeof entry.lastTo === 'string' && entry.lastTo) ||
    sessionKey ||
    sessionId
  );
}

export function parseSessionsIndex(config: AppConfig): SessionIndexEntry[] {
  if (!fs.existsSync(config.sessionsIndexFile)) {
    throw new Error(`sessions index missing at ${config.sessionsIndexFile}`);
  }

  const parsed = JSON.parse(fs.readFileSync(config.sessionsIndexFile, 'utf8')) as unknown;
  if (!isRecord(parsed)) {
    return [];
  }

  return Object.entries(parsed)
    .map(([sessionKey, value]) => {
      const entry = isRecord(value) ? value : {};
      const sessionId =
        (typeof entry.sessionId === 'string' && entry.sessionId) ||
        path.basename(typeof entry.sessionFile === 'string' ? entry.sessionFile : '', '.jsonl') ||
        sessionKey;
      const sessionFilePath =
        typeof entry.sessionFile === 'string' && entry.sessionFile
          ? entry.sessionFile
          : path.join(config.sessionsDir, `${sessionId}.jsonl`);
      const origin = isRecord(entry.origin) ? entry.origin : null;
      const deliveryContext = isRecord(entry.deliveryContext) ? entry.deliveryContext : null;

      return {
        sessionKey,
        sessionId,
        sessionFilePath,
        updatedAt:
          (typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
            ? Math.trunc(entry.updatedAt)
            : 0) || Date.now(),
        title: toTitle(entry, sessionKey, sessionId),
        provider:
          (typeof origin?.provider === 'string' && origin.provider) ||
          (typeof deliveryContext?.channel === 'string' && deliveryContext.channel) ||
          'unknown',
        chatType:
          (typeof entry.chatType === 'string' && entry.chatType) ||
          (typeof origin?.chatType === 'string' && origin.chatType) ||
          'unknown',
        deliveryTarget:
          (typeof deliveryContext?.to === 'string' && deliveryContext.to) ||
          (typeof entry.lastTo === 'string' && entry.lastTo) ||
          '-',
        raw: entry,
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function parseJsonlRows(filePath: string): JsonRecord[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const text = fs.readFileSync(filePath, 'utf8');

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, index) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (isRecord(parsed)) {
          return [{ ...parsed, __rowIndex: index }];
        }
      } catch {
        return [];
      }

      return [];
    });
}

function pushAction(
  actions: ActionWriteInput[],
  sessionId: string,
  input: Omit<ActionWriteInput, 'id' | 'sessionId' | 'sequence'>
) {
  const sequence = actions.length + 1;
  actions.push({
    ...input,
    id: `${sessionId}:${sequence}`,
    sessionId,
    sequence,
  });
}

export function buildActions(sessionId: string, rows: JsonRecord[]): ActionWriteInput[] {
  const actions: ActionWriteInput[] = [];

  for (const row of rows) {
    const rowType = typeof row.type === 'string' ? row.type : '';
    const rowTimestamp = parseTimestampMs(row.timestamp);

    if (rowType === 'custom' && row.customType === 'openclaw:prompt-error' && isRecord(row.data)) {
      const errorMessage =
        (typeof row.data.error === 'string' && row.data.error) || 'Prompt request aborted.';
      const startedAt = parseTimestampMs(row.data.timestamp) ?? rowTimestamp;

      pushAction(actions, sessionId, {
        kind: 'assistantError',
        status: 'failed',
        title: 'Prompt error',
        summary: previewText(errorMessage),
        startedAt,
        endedAt: startedAt,
        cursor: null,
        payload: {
          source: 'openclaw:prompt-error',
          data: compactPayload(row.data),
        },
      });
      continue;
    }

    if (rowType !== 'message') {
      continue;
    }

    const message = isRecord(row.message) ? row.message : null;
    if (!message) {
      continue;
    }

    const role = typeof message.role === 'string' ? message.role : '';
    const startedAt = parseTimestampMs(message.timestamp) ?? rowTimestamp;
    const content = Array.isArray(message.content) ? message.content : [];

    if (role === 'user') {
      const text = normalizeUserText(extractTextContent(content));
      pushAction(actions, sessionId, {
        kind: 'user',
        status: bestEffortActionStatus('user'),
        title: 'User message',
        summary: previewText(text || '(empty user message)'),
        startedAt,
        endedAt: startedAt,
        cursor: null,
        payload: {
          messageId: row.id ?? null,
          rowIndex: row.__rowIndex ?? null,
          text: compactText(text),
        },
      });
      continue;
    }

    if (role === 'assistant') {
      for (const item of content) {
        if (!isRecord(item) || typeof item.type !== 'string') {
          continue;
        }

        if (item.type === 'thinking') {
          const thinking = compactText(typeof item.thinking === 'string' ? item.thinking : '');
          pushAction(actions, sessionId, {
            kind: 'think',
            status: bestEffortActionStatus('think'),
            title: 'Reasoning trace',
            summary: previewText(thinking || '(empty reasoning trace)'),
            startedAt,
            endedAt: startedAt,
            cursor: null,
            payload: {
              messageId: row.id ?? null,
              rowIndex: row.__rowIndex ?? null,
              thinking,
            },
          });
          continue;
        }

        if (item.type === 'toolCall') {
          pushAction(actions, sessionId, {
            kind: 'toolCall',
            status: bestEffortActionStatus('toolCall'),
            title: typeof item.name === 'string' && item.name ? item.name : 'unknown tool',
            summary: previewText(
              stringifyValue(isRecord(item.arguments) || Array.isArray(item.arguments) ? item.arguments : {})
            ),
            startedAt,
            endedAt: startedAt,
            cursor: null,
            payload: {
              messageId: row.id ?? null,
              rowIndex: row.__rowIndex ?? null,
              toolCallId: typeof item.id === 'string' ? item.id : null,
              name: typeof item.name === 'string' ? item.name : null,
              arguments: compactPayload(item.arguments),
            },
          });
          continue;
        }

        if (item.type === 'text') {
          const cleanedText = cleanAssistantText(typeof item.text === 'string' ? item.text : '');
          const kind = message.stopReason === 'stop' ? 'reply' : 'assistantText';
          pushAction(actions, sessionId, {
            kind,
            status: bestEffortActionStatus(kind),
            title: kind === 'reply' ? 'Final reply' : 'Assistant text',
            summary: previewText(cleanedText || '(empty assistant text)'),
            startedAt,
            endedAt: startedAt,
            cursor: null,
            payload: {
              messageId: row.id ?? null,
              rowIndex: row.__rowIndex ?? null,
              stopReason: typeof message.stopReason === 'string' ? message.stopReason : null,
              text: compactText(cleanedText),
            },
          });
          continue;
        }

        pushAction(actions, sessionId, {
          kind: 'system',
          status: null,
          title: item.type,
          summary: previewText(stringifyValue(item)),
          startedAt,
          endedAt: startedAt,
          cursor: null,
          payload: compactPayload(item),
        });
      }

      const stopReason = typeof message.stopReason === 'string' ? message.stopReason : null;
      if (stopReason && stopReason !== 'stop' && stopReason !== 'toolUse') {
        const errorMessage =
          (typeof message.errorMessage === 'string' && message.errorMessage) ||
          (stopReason === 'error' ? 'Assistant run failed.' : `stopReason=${stopReason}`);

        pushAction(actions, sessionId, {
          kind: 'assistantError',
          status: 'failed',
          title: 'Assistant error',
          summary: previewText(errorMessage),
          startedAt,
          endedAt: startedAt,
          cursor: null,
          payload: {
            messageId: row.id ?? null,
            rowIndex: row.__rowIndex ?? null,
            stopReason,
            errorMessage: compactText(errorMessage),
          },
        });
      }

      continue;
    }

    if (role === 'toolResult') {
      const isError = detectToolResultError(message);
      const toolResultText = extractTextContent(content) || stringifyValue(message.details);

      pushAction(actions, sessionId, {
        kind: 'toolResult',
        status: bestEffortActionStatus('toolResult', isError),
        title:
          (typeof message.toolName === 'string' && message.toolName) || 'tool result',
        summary: previewText(toolResultText || '(empty tool result)'),
        startedAt,
        endedAt: startedAt,
        cursor: null,
        payload: {
          messageId: row.id ?? null,
          rowIndex: row.__rowIndex ?? null,
          toolCallId:
            typeof message.toolCallId === 'string' ? message.toolCallId : null,
          toolName: typeof message.toolName === 'string' ? message.toolName : null,
          text: compactText(toolResultText),
          details: compactPayload(message.details),
          isError,
        },
      });
    }
  }

  return actions;
}

export function buildSessionRecord(
  entry: SessionIndexEntry,
  rows: JsonRecord[],
  actions: ActionWriteInput[],
  config: AppConfig
): SessionWriteInput {
  const sessionRow = rows.find((row) => row.type === 'session') ?? null;
  const firstStartedAt = parseTimestampMs(sessionRow?.timestamp);
  const firstUser = actions.find((action) => action.kind === 'user') ?? null;
  const lastAction = actions[actions.length - 1] ?? null;
  const status = deriveSessionStatus(actions, entry.updatedAt, config, entry.raw);
  const metadata = {
    sessionKey: entry.sessionKey,
    sessionFile: path.basename(entry.sessionFilePath),
    provider: entry.provider,
    chatType: entry.chatType,
    deliveryTarget: entry.deliveryTarget,
    firstUserText: firstUser?.summary ?? null,
    actionCount: actions.length,
    lastActionKind: lastAction?.kind ?? null,
    lastActionAt: lastAction?.endedAt ?? lastAction?.startedAt ?? null,
    sourceUpdatedAt: entry.updatedAt,
    sessionFileExists: fs.existsSync(entry.sessionFilePath),
    systemSent: entry.raw.systemSent === true,
    abortedLastRun: entry.raw.abortedLastRun === true,
  };

  return {
    id: entry.sessionId,
    title: entry.title,
    status,
    startedAt: firstStartedAt ?? firstUser?.startedAt ?? null,
    updatedAt: Math.max(
      entry.updatedAt,
      lastAction?.endedAt ?? lastAction?.startedAt ?? 0,
      firstStartedAt ?? 0
    ),
    lastActionSummary: summarizeAction(lastAction),
    metadata,
  };
}

function parseNestedString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value ? value : null;
}

function parseNestedNumber(record: JsonRecord, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function extractRawIdentifiers(payload: JsonRecord): {
  sessionId: string | null;
  runId: string | null;
} {
  const topLevelSessionId = parseNestedString(payload, 'sessionId');
  const topLevelRunId = parseNestedString(payload, 'runId');

  if (topLevelSessionId || topLevelRunId) {
    return {
      sessionId: topLevelSessionId,
      runId: topLevelRunId,
    };
  }

  const nestedData = isRecord(payload.data) ? payload.data : null;

  return {
    sessionId: nestedData ? parseNestedString(nestedData, 'sessionId') : null,
    runId: nestedData ? parseNestedString(nestedData, 'runId') : null,
  };
}

function readRawCursor(store: EventStore): { inode: number | null; position: number } {
  const rawCursor = store.getIngestCursor(RAW_STREAM_CURSOR_NAME);

  if (!rawCursor) {
    return { inode: null, position: 0 };
  }

  try {
    const parsed = JSON.parse(rawCursor) as unknown;
    if (isRecord(parsed)) {
      return {
        inode: parseNestedNumber(parsed, 'inode'),
        position: parseNestedNumber(parsed, 'position') ?? 0,
      };
    }
  } catch {
    return { inode: null, position: 0 };
  }

  return { inode: null, position: 0 };
}

function ingestRawStream(store: EventStore, config: AppConfig): void {
  if (!fs.existsSync(config.rawStreamFile)) {
    return;
  }

  const stats = fs.statSync(config.rawStreamFile);
  const previous = readRawCursor(store);
  const currentInode = Number.isFinite(stats.ino) ? stats.ino : null;
  let startPosition = previous.position;

  if (
    previous.inode == null ||
    currentInode == null ||
    previous.inode !== currentInode ||
    stats.size < startPosition
  ) {
    startPosition = 0;
  }

  if (stats.size <= startPosition) {
    store.setIngestCursor(
      RAW_STREAM_CURSOR_NAME,
      JSON.stringify({
        inode: currentInode,
        position: stats.size,
      })
    );
    return;
  }

  const fileBuffer = fs.readFileSync(config.rawStreamFile);
  const rawSlice = fileBuffer.subarray(startPosition).toString('utf8');

  const entries: RawStreamWriteInput[] = [];
  let byteOffset = startPosition;

  for (const line of rawSlice.split(/\r?\n/)) {
    const lineBytes = Buffer.byteLength(`${line}\n`, 'utf8');
    const trimmed = line.trim();

    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (isRecord(parsed)) {
          const identifiers = extractRawIdentifiers(parsed);
          const eventTs = parseNestedNumber(parsed, 'ts') ?? Date.now();
          const kind =
            parseNestedString(parsed, 'event') ||
            parseNestedString(parsed, 'type') ||
            parseNestedString(parsed, 'kind') ||
            'raw_event';

          entries.push({
            eventId: `raw:${hashValue(`${byteOffset}:${trimmed}`)}`,
            sessionId: identifiers.sessionId,
            runId: identifiers.runId,
            source: 'raw_stream',
            kind,
            eventTs,
            payload: {
              ...parsed,
              _sourceOffset: byteOffset,
            },
          });
        } else {
          entries.push({
            eventId: `raw:${hashValue(`${byteOffset}:${trimmed}`)}`,
            sessionId: null,
            runId: null,
            source: 'raw_stream',
            kind: 'raw_event',
            eventTs: Date.now(),
            payload: {
              rawLine: truncateText(trimmed, MAX_TEXT_PAYLOAD_CHARS),
              _sourceOffset: byteOffset,
            },
          });
        }
      } catch {
        entries.push({
          eventId: `raw:${hashValue(`${byteOffset}:${trimmed}`)}`,
          sessionId: null,
          runId: null,
          source: 'raw_stream',
          kind: 'raw_event',
          eventTs: Date.now(),
          payload: {
            rawLine: truncateText(trimmed, MAX_TEXT_PAYLOAD_CHARS),
            _sourceOffset: byteOffset,
          },
        });
      }
    }

    byteOffset += lineBytes;
  }

  store.appendRawStreamEntries(entries);
  store.setIngestCursor(
    RAW_STREAM_CURSOR_NAME,
    JSON.stringify({
      inode: currentInode,
      position: stats.size,
    })
  );
}

function toSessionSummary(session: SessionWriteInput): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    lastActionSummary: session.lastActionSummary,
    metadata: session.metadata ?? null,
  };
}

function toActionHistoryItem(action: ActionWriteInput): ActionHistoryItem {
  return {
    eventId: action.id,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: action.kind,
    status: action.status,
    title: action.title,
    summary: action.summary,
    startedAt: action.startedAt,
    endedAt: action.endedAt,
    cursor: action.cursor,
    payload: action.payload,
  };
}

function ingestSessions(
  store: EventStore,
  config: AppConfig,
  fileCache: Map<string, SessionFileCache>
): { sessions: SessionWriteInput[]; actions: ActionWriteInput[] } {
  const indexEntries = parseSessionsIndex(config);
  const sessions: SessionWriteInput[] = [];
  const actions: ActionWriteInput[] = [];
  const seenPaths = new Set<string>();

  for (const entry of indexEntries) {
    seenPaths.add(entry.sessionFilePath);

    let fileMtime = 0;
    let fileSize = 0;
    try {
      const stat = fs.statSync(entry.sessionFilePath);
      fileMtime = stat.mtimeMs;
      fileSize = stat.size;
    } catch {
      continue;
    }

    const cached = fileCache.get(entry.sessionFilePath);
    if (
      cached &&
      cached.mtime === fileMtime &&
      cached.size === fileSize &&
      cached.indexUpdatedAt === entry.updatedAt
    ) {
      sessions.push(...cached.sessions);
      actions.push(...cached.actions);
      continue;
    }

    const rows = parseJsonlRows(entry.sessionFilePath);
    const sessionActions = buildActions(entry.sessionId, rows);
    const sessionRecord = buildSessionRecord(entry, rows, sessionActions, config);

    sessions.push(sessionRecord);
    actions.push(...sessionActions);

    fileCache.set(entry.sessionFilePath, {
      mtime: fileMtime,
      size: fileSize,
      indexUpdatedAt: entry.updatedAt,
      sessions: [sessionRecord],
      actions: sessionActions,
    });
  }

  // Evict stale cache entries for sessions that no longer exist
  for (const key of fileCache.keys()) {
    if (!seenPaths.has(key)) {
      fileCache.delete(key);
    }
  }

  store.replaceSessionsAndActions(sessions, actions);
  return { sessions, actions };
}

export function createIngestService(config: AppConfig, store: EventStore) {
  let sessionTimer: NodeJS.Timeout | null = null;
  let rawTimer: NodeJS.Timeout | null = null;

  const notifications = new EventEmitter() as IngestNotifications;
  notifications.setMaxListeners(100);

  const sessionFileCache = new Map<string, SessionFileCache>();
  let prevSnapshot = new Map<string, SessionFingerprint>();

  const state: IngestState = {
    initialLoadCompleted: false,
    lastSessionSyncAt: null,
    lastRawSyncAt: null,
    sessionSyncError: null,
    rawSyncError: null,
    sessionsIndexFile: config.sessionsIndexFile,
    rawStreamFile: config.rawStreamFile,
  };

  function emitSessionDiff(
    sessions: SessionWriteInput[],
    actions: ActionWriteInput[]
  ) {
    const nextSnapshot = new Map<string, SessionFingerprint>();

    for (const session of sessions) {
      const sessionActions = actions.filter((a) => a.sessionId === session.id);
      const actionCount = sessionActions.length;
      nextSnapshot.set(session.id, { status: session.status, updatedAt: session.updatedAt, actionCount });

      const prev = prevSnapshot.get(session.id);
      const sessionSummary = toSessionSummary(session);

      if (!prev) {
        notifications.emit('session_changed', { change: 'added', session: sessionSummary });
        if (actionCount > 0) {
          const latestActions = sessionActions.slice(-100);
          notifications.emit('action_changed', { sessionId: session.id, actions: latestActions.map(toActionHistoryItem) });
        }
      } else {
        const sessionChanged = prev.status !== session.status || prev.updatedAt !== session.updatedAt;
        const actionsChanged = prev.actionCount !== actionCount;

        if (sessionChanged) {
          notifications.emit('session_changed', { change: 'updated', session: sessionSummary });
        }
        if (actionsChanged) {
          const latestActions = sessionActions.slice(-100);
          notifications.emit('action_changed', { sessionId: session.id, actions: latestActions.map(toActionHistoryItem) });
        }
      }
    }

    for (const [id] of prevSnapshot) {
      if (!nextSnapshot.has(id)) {
        notifications.emit('session_changed', { change: 'removed', sessionId: id });
      }
    }

    prevSnapshot = nextSnapshot;
  }

  function runSessionSync() {
    try {
      const { sessions, actions } = ingestSessions(store, config, sessionFileCache);
      state.lastSessionSyncAt = Date.now();
      state.sessionSyncError = null;
      emitSessionDiff(sessions, actions);
    } catch (error) {
      state.sessionSyncError = error instanceof Error ? error.message : 'Unknown session ingest error';
    }
  }

  function runRawSync() {
    try {
      ingestRawStream(store, config);
      state.lastRawSyncAt = Date.now();
      state.rawSyncError = null;
    } catch (error) {
      state.rawSyncError = error instanceof Error ? error.message : 'Unknown raw stream ingest error';
    }
  }

  return {
    notifications,

    start() {
      runSessionSync();
      runRawSync();

      state.initialLoadCompleted = true;

      sessionTimer = setInterval(runSessionSync, config.ingestPollMs);
      sessionTimer.unref();

      rawTimer = setInterval(runRawSync, config.ingestPollMs);
      rawTimer.unref();
    },

    stop() {
      if (sessionTimer) {
        clearInterval(sessionTimer);
        sessionTimer = null;
      }

      if (rawTimer) {
        clearInterval(rawTimer);
        rawTimer = null;
      }
    },

    getState(): IngestState {
      return { ...state };
    },
  };
}

export type IngestService = ReturnType<typeof createIngestService>;
