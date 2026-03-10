import type {
  ActionHistoryItem,
  RawDebugEvent,
  SessionStatus,
  SessionSummary,
} from '../domain/events';
import type { DatabaseClient } from '../db/sqlite';

export type SessionWriteInput = {
  id: string;
  title: string | null;
  status: SessionStatus;
  startedAt: number | null;
  updatedAt: number;
  lastActionSummary: string | null;
  metadata: unknown | null;
};

export type ActionWriteInput = {
  id: string;
  sessionId: string;
  sequence: number;
  kind: ActionHistoryItem['kind'];
  status: ActionHistoryItem['status'];
  title: string;
  summary: string | null;
  startedAt: number | null;
  endedAt: number | null;
  cursor: number | null;
  payload: unknown;
};

export type RawStreamWriteInput = {
  eventId: string;
  sessionId: string | null;
  runId: string | null;
  source: RawDebugEvent['source'];
  kind: string;
  eventTs: number;
  payload: unknown;
};

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

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
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

  const latestRawStreamCursorStatement = db.prepare(`
    SELECT COALESCE(MAX(stream_cursor), 0) AS latestCursor
    FROM raw_stream_entries
  `);

  const metricsStatement = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sessions) AS sessionCount,
      (SELECT COUNT(*) FROM action_events) AS actionEventCount,
      (SELECT COUNT(*) FROM raw_stream_entries) AS rawStreamCount,
      (SELECT COALESCE(MAX(stream_cursor), 0) FROM raw_stream_entries) AS latestStreamCursor
  `);

  const insertSessionStatement = db.prepare(`
    INSERT INTO sessions (
      id,
      title,
      status,
      started_at,
      updated_at,
      last_action_summary,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      status = excluded.status,
      started_at = excluded.started_at,
      updated_at = excluded.updated_at,
      last_action_summary = excluded.last_action_summary,
      metadata_json = excluded.metadata_json
  `);

  const deleteAllSessionsStatement = db.prepare(`
    DELETE FROM sessions
  `);

  const deleteActionEventsBySessionStatement = db.prepare(`
    DELETE FROM action_events
    WHERE session_id = ?
  `);

  const insertActionEventStatement = db.prepare(`
    INSERT INTO action_events (
      id,
      session_id,
      sequence,
      kind,
      status,
      title,
      summary,
      started_at,
      ended_at,
      cursor,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      session_id = excluded.session_id,
      sequence = excluded.sequence,
      kind = excluded.kind,
      status = excluded.status,
      title = excluded.title,
      summary = excluded.summary,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      cursor = excluded.cursor,
      payload_json = excluded.payload_json
  `);

  const insertRawStreamEntryStatement = db.prepare(`
    INSERT OR IGNORE INTO raw_stream_entries (
      event_id,
      session_id,
      run_id,
      source,
      kind,
      event_ts,
      payload_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getIngestCursorStatement = db.prepare(`
    SELECT cursor
    FROM ingest_cursors
    WHERE name = ?
  `);

  const upsertIngestCursorStatement = db.prepare(`
    INSERT INTO ingest_cursors (name, cursor, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      cursor = excluded.cursor,
      updated_at = excluded.updated_at
  `);

  const replaceSessionsAndActionsTransaction = db.transaction(
    (sessions: SessionWriteInput[], actions: ActionWriteInput[]) => {
      if (sessions.length > 0) {
        const placeholders = sessions.map(() => '?').join(', ');
        db.prepare(`DELETE FROM sessions WHERE id NOT IN (${placeholders})`).run(
          ...sessions.map((session) => session.id)
        );
      } else {
        deleteAllSessionsStatement.run();
      }

      for (const session of sessions) {
        insertSessionStatement.run(
          session.id,
          session.title,
          session.status,
          session.startedAt,
          session.updatedAt,
          session.lastActionSummary,
          serializeJson(session.metadata)
        );
        deleteActionEventsBySessionStatement.run(session.id);
      }

      for (const action of actions) {
        insertActionEventStatement.run(
          action.id,
          action.sessionId,
          action.sequence,
          action.kind,
          action.status,
          action.title,
          action.summary,
          action.startedAt,
          action.endedAt,
          action.cursor,
          serializeJson(action.payload)
        );
      }
    }
  );

  const appendRawStreamEntriesTransaction = db.transaction((entries: RawStreamWriteInput[]) => {
    let inserted = 0;

    for (const entry of entries) {
      const result = insertRawStreamEntryStatement.run(
        entry.eventId,
        entry.sessionId,
        entry.runId,
        entry.source,
        entry.kind,
        entry.eventTs,
        serializeJson(entry.payload),
        Date.now()
      );

      inserted += result.changes;
    }

    return inserted;
  });

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

    getLatestRawStreamCursor(): number {
      const row = latestRawStreamCursorStatement.get() as { latestCursor: number };
      return row.latestCursor;
    },

    replaceSessionsAndActions(sessions: SessionWriteInput[], actions: ActionWriteInput[]) {
      replaceSessionsAndActionsTransaction(sessions, actions);
    },

    appendRawStreamEntries(entries: RawStreamWriteInput[]): number {
      if (entries.length === 0) {
        return 0;
      }

      return appendRawStreamEntriesTransaction(entries);
    },

    getIngestCursor(name: string): string | null {
      const row = getIngestCursorStatement.get(name) as { cursor: string } | undefined;
      return row?.cursor ?? null;
    },

    setIngestCursor(name: string, cursor: string) {
      upsertIngestCursorStatement.run(name, cursor, Date.now());
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
