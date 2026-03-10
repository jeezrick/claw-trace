import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { AppConfig } from '../config';

export type DatabaseClient = InstanceType<typeof Database>;

export function createDatabase(config: AppConfig): DatabaseClient {
  fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

  const db = new Database(config.databaseFile);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      started_at INTEGER,
      updated_at INTEGER NOT NULL,
      last_action_summary TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS action_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      kind TEXT NOT NULL,
      status TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      cursor INTEGER,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      UNIQUE (session_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS raw_stream_entries (
      stream_cursor INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      session_id TEXT,
      run_id TEXT,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      event_ts INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingest_cursors (
      name TEXT PRIMARY KEY,
      cursor TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
      ON sessions(updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_action_events_session_sequence
      ON action_events(session_id, sequence DESC);

    CREATE INDEX IF NOT EXISTS idx_raw_stream_entries_session_cursor
      ON raw_stream_entries(session_id, stream_cursor);
  `);

  return db;
}
