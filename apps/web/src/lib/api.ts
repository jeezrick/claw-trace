export type SessionStatus =
  | 'running'
  | 'stalled'
  | 'failed'
  | 'completed'
  | 'idle'
  | 'unknown';
export type ActionEventKind =
  | 'user'
  | 'think'
  | 'toolCall'
  | 'toolResult'
  | 'reply'
  | 'assistantError'
  | 'assistantText'
  | 'system';
export type EventSourceName = 'session_jsonl' | 'raw_stream' | 'system';

export type SessionMetadata = {
  sessionKey: string;
  sessionFile: string;
  provider: string;
  chatType: string;
  deliveryTarget: string;
  firstUserText: string | null;
  actionCount: number;
  lastActionKind: ActionEventKind | null;
  lastActionAt: number | null;
  sourceUpdatedAt: number;
  sessionFileExists: boolean;
  systemSent: boolean;
  abortedLastRun: boolean;
};

export type SessionSummary = {
  id: string;
  title: string | null;
  status: SessionStatus;
  startedAt: number | null;
  updatedAt: number;
  lastActionSummary: string | null;
  metadata: SessionMetadata | null;
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

export type ChainSummary = {
  user: number;
  think: number;
  toolCall: number;
  toolResult: number;
  reply: number;
  assistantError: number;
  assistantText: number;
  system: number;
  tools: string[];
};

export type ChainStep = {
  eventId: string;
  sequence: number;
  kind: ActionEventKind;
  label: string;
  title: string;
  timestamp: number | null;
  body: string;
  meta: string;
  isError: boolean;
  raw: unknown | null;
};

export type TerminalMessageItem = {
  key: string;
  eventId: string;
  ordinal: number;
  timestamp: number | null;
  rowIndex: number | null;
  preview: string;
  fullText: string;
  pending: boolean;
  startSequence: number;
  endSequence: number;
  stepCount: number;
  triggerUserText: string | null;
  summary: ChainSummary;
  steps: ChainStep[];
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
  liveTailReady: boolean;
  sessionId: string | null;
  resumeCursor: number;
  latestCursor: number;
  workspace?: string;
};

export type AgentWorkspaceOption = {
  id: string;
  label: string;
  sessionsDir: string;
  sessionsIndexFile: string;
  sessionCount: number;
  isDefault: boolean;
};

export type WorkspaceListResponse = {
  items: AgentWorkspaceOption[];
  defaultWorkspaceId: string;
};

export type SessionListResponse = {
  items: SessionSummary[];
  nextCursor: string | null;
  ingestReady: boolean;
  meta: {
    sessionCount: number;
    actionEventCount: number;
    rawStreamCount: number;
    latestStreamCursor: number;
    workspaceId?: string;
    ingest: {
      initialLoadCompleted: boolean;
      lastSessionSyncAt: number | null;
      lastRawSyncAt: number | null;
      sessionSyncError: string | null;
      rawSyncError: string | null;
      sessionsIndexFile: string;
      rawStreamFile: string;
    };
  };
};

export type ActionHistoryResponse = {
  sessionId: string;
  session: SessionSummary | null;
  items: ActionHistoryItem[];
  ingestReady: boolean;
};

export type SessionDetailResponse = {
  sessionId: string;
  session: SessionSummary | null;
  terminalMessages: TerminalMessageItem[];
  ingestReady: boolean;
};

const apiBase = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') {
      continue;
    }

    query.set(key, String(value));
  }

  const text = query.toString();
  return text ? `?${text}` : '';
}

async function fetchJson<T>(pathname: string): Promise<T> {
  const response = await fetch(`${apiBase}${pathname}`);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export function listWorkspaces() {
  return fetchJson<WorkspaceListResponse>('/api/v2/workspaces');
}

export function listSessions(limit = 50, workspace?: string) {
  return fetchJson<SessionListResponse>(
    `/api/v2/sessions${buildQuery({ limit, workspace })}`
  );
}

export function getActionHistory(sessionId: string, limit = 100, workspace?: string) {
  return fetchJson<ActionHistoryResponse>(
    `/api/v2/sessions/${encodeURIComponent(sessionId)}/actions${buildQuery({ limit, workspace })}`
  );
}

export function getSessionDetail(sessionId: string, workspace?: string) {
  return fetchJson<SessionDetailResponse>(
    `/api/v2/sessions/${encodeURIComponent(sessionId)}/detail${buildQuery({ workspace })}`
  );
}

export function createDebugEventSource(options: {
  sessionId?: string;
  cursor?: number;
  workspace?: string;
} = {}) {
  const query = buildQuery({
    sessionId: options.sessionId,
    cursor: options.cursor,
    workspace: options.workspace,
  });

  return new EventSource(`${apiBase}/api/v2/stream${query}`);
}

export function parseEventData<T>(event: MessageEvent<string>): T {
  return JSON.parse(event.data) as T;
}
