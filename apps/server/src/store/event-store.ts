import type {
  ActionHistoryItem,
  RawDebugEvent,
  SessionSummary,
} from '../domain/events';
import type { DatabaseClient } from '../db/sqlite';

type SessionRow = {
  id: string;
  title: string | null;
  status: SessionSummary['status'];
  startedAt: number | null;
  updatedAt: number;
  lastActionSummary: string | null;
  metadataJson: string | null;
};

type ActionRow = {
  eventId: string;
  sessionId: string;
  sequence: number;
  kind: ActionHistoryItem['kind'];
  status: ActionHistoryItem['status'];
  title: string;
  summary: string | null;
  startedAt: number | null;
  endedAt: number | null;
  cursor: number | null;
  payloadJson: string;
};

type RawStreamRow = {
  streamCursor: number;
  eventId: string;
  sessionId: string | null;
  runId: string | null;
  source: RawDebugEvent['source'];
  kind: string;
  eventTs: number;
  payloadJson: string;
};

function parseJson(value: string | null): unknown | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapSessionRow(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    lastActionSummary: row.lastActionSummary,
    metadata: parseJson(row.metadataJson),
  };
}

function mapActionRow(row: ActionRow): ActionHistoryItem {
  return {
    eventId: row.eventId,
    sessionId: row.sessionId,
    sequence: row.sequence,
    kind: row.kind,
    status: row.status,
    title: row.title,
    summary: row.summary,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    cursor: row.cursor,
    payload: parseJson(row.payloadJson),
  };
}

function mapRawStreamRow(row: RawStreamRow): RawDebugEvent {
  return {
    streamCursor: row.streamCursor,
    eventId: row.eventId,
    sessionId: row.sessionId,
    runId: row.runId,
    source: row.source,
    kind: row.kind,
    eventTs: row.eventTs,
    payload: parseJson(row.payloadJson),
  };
}

export function createEventStore(db: DatabaseClient) {
  const listSessionsStatement = db.prepare(`
    SELECT
      id,
      title,
      status,
      started_at AS startedAt,
      updated_at AS updatedAt,
      last_action_summary AS lastActionSummary,
      metadata_json AS metadataJson
    FROM sessions
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `);

  const getSessionStatement = db.prepare(`
    SELECT
      id,
      title,
      status,
      started_at AS startedAt,
      updated_at AS updatedAt,
      last_action_summary AS lastActionSummary,
      metadata_json AS metadataJson
    FROM sessions
    WHERE id = ?
  `);

  const listActionHistoryStatement = db.prepare(`
    SELECT
      id AS eventId,
      session_id AS sessionId,
      sequence,
      kind,
      status,
      title,
      summary,
      started_at AS startedAt,
      ended_at AS endedAt,
      cursor,
      payload_json AS payloadJson
    FROM action_events
    WHERE session_id = ?
    ORDER BY sequence DESC
    LIMIT ?
  `);

  const listRawStreamEntriesStatement = db.prepare(`
    SELECT
      stream_cursor AS streamCursor,
      event_id AS eventId,
      session_id AS sessionId,
      run_id AS runId,
      source,
      kind,
      event_ts AS eventTs,
      payload_json AS payloadJson
    FROM raw_stream_entries
    WHERE stream_cursor > ?
      AND (? IS NULL OR session_id = ?)
    ORDER BY stream_cursor ASC
    LIMIT ?
  `);

  const metricsStatement = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sessions) AS sessionCount,
      (SELECT COUNT(*) FROM action_events) AS actionEventCount,
      (SELECT COUNT(*) FROM raw_stream_entries) AS rawStreamCount,
      (SELECT COALESCE(MAX(stream_cursor), 0) FROM raw_stream_entries) AS latestStreamCursor
  `);

  return {
    listSessions(limit: number): SessionSummary[] {
      return (listSessionsStatement.all(limit) as SessionRow[]).map(mapSessionRow);
    },

    getSession(sessionId: string): SessionSummary | null {
      const row = getSessionStatement.get(sessionId) as SessionRow | undefined;
      return row ? mapSessionRow(row) : null;
    },

    listActionHistory(sessionId: string, limit: number): ActionHistoryItem[] {
      const rows = listActionHistoryStatement.all(sessionId, limit) as ActionRow[];
      return rows.reverse().map(mapActionRow);
    },

    listRawStreamEntriesAfter(
      cursor: number,
      limit: number,
      sessionId?: string
    ): RawDebugEvent[] {
      return (
        listRawStreamEntriesStatement.all(cursor, sessionId ?? null, sessionId ?? null, limit) as RawStreamRow[]
      ).map(mapRawStreamRow);
    },

    getMetrics(): {
      sessionCount: number;
      actionEventCount: number;
      rawStreamCount: number;
      latestStreamCursor: number;
    } {
      return metricsStatement.get() as {
        sessionCount: number;
        actionEventCount: number;
        rawStreamCount: number;
        latestStreamCursor: number;
      };
    },
  };
}

export type EventStore = ReturnType<typeof createEventStore>;
