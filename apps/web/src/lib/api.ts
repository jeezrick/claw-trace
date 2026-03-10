export type SessionStatus = 'running' | 'stalled' | 'failed' | 'completed' | 'unknown';
export type ActionEventKind =
  | 'input'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'assistant'
  | 'error'
  | 'system';
export type EventSourceName = 'session_jsonl' | 'raw_stream' | 'system';

export type SessionSummary = {
  id: string;
  title: string | null;
  status: SessionStatus;
  startedAt: number | null;
  updatedAt: number;
  lastActionSummary: string | null;
  metadata: unknown | null;
};

export type ActionHistoryItem = {
  eventId: string;
  sessionId: string;
  sequence: number;
  kind: ActionEventKind;
  status: SessionStatus | null;
  title: string;
  summary: string | null;
  startedAt: number | null;
  endedAt: number | null;
  cursor: number | null;
  payload: unknown;
};

export type RawDebugEvent = {
  streamCursor: number;
  eventId: string;
  sessionId: string | null;
  runId: string | null;
  source: EventSourceName;
  kind: string;
  eventTs: number;
  payload: unknown;
};

export type StreamReadyEvent = {
  placeholder: boolean;
  liveTailReady: boolean;
  sessionId: string | null;
  resumeCursor: number;
};

export type SessionListResponse = {
  items: SessionSummary[];
  nextCursor: string | null;
  placeholder: boolean;
  ingestReady: boolean;
  meta: {
    sessionCount: number;
    actionEventCount: number;
    rawStreamCount: number;
    latestStreamCursor: number;
  };
};

export type ActionHistoryResponse = {
  sessionId: string;
  session: SessionSummary | null;
  items: ActionHistoryItem[];
  placeholder: boolean;
  ingestReady: boolean;
};

const apiBase = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

async function fetchJson<T>(pathname: string): Promise<T> {
  const response = await fetch(`${apiBase}${pathname}`);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export function listSessions(limit = 50) {
  return fetchJson<SessionListResponse>(`/api/v2/sessions?limit=${limit}`);
}

export function getActionHistory(sessionId: string, limit = 100) {
  return fetchJson<ActionHistoryResponse>(
    `/api/v2/sessions/${encodeURIComponent(sessionId)}/actions?limit=${limit}`
  );
}

export function createDebugEventSource(options: {
  sessionId?: string;
  cursor?: number;
}) {
  const params = new URLSearchParams();

  if (options.sessionId) {
    params.set('sessionId', options.sessionId);
  }

  if (typeof options.cursor === 'number') {
    params.set('cursor', String(options.cursor));
  }

  const query = params.toString();
  return new EventSource(`${apiBase}/api/v2/stream${query ? `?${query}` : ''}`);
}

export function parseEventData<T>(event: MessageEvent<string>): T {
  return JSON.parse(event.data) as T;
}
