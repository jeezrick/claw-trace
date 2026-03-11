import { startTransition, useEffect } from 'react';

import { ActionHistoryPanel } from './components/ActionHistoryPanel';
import { AppShell } from './components/AppShell';
import { DebugStreamPanel } from './components/DebugStreamPanel';
import { SessionListPanel } from './components/SessionListPanel';
import {
  createDebugEventSource,
  getActionHistory,
  listSessions,
  parseEventData,
  type RawDebugEvent,
  type StreamReadyEvent,
} from './lib/api';
import { useAppStore } from './store/app-store';

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function isUsefulRawEvent(event: RawDebugEvent) {
  if (event.kind === 'assistant_text_stream') {
    return false;
  }

  const payload =
    event.payload && typeof event.payload === 'object'
      ? (event.payload as Record<string, unknown>)
      : null;

  if (event.kind === 'assistant_thinking_stream') {
    return payload?.evtType === 'thinking_end';
  }

  return true;
}

export default function App() {
  const sessions = useAppStore((state) => state.sessions);
  const sessionsState = useAppStore((state) => state.sessionsState);
  const sessionsRefreshing = useAppStore((state) => state.sessionsRefreshing);
  const sessionsLastLoadedAt = useAppStore((state) => state.sessionsLastLoadedAt);
  const sessionsError = useAppStore((state) => state.sessionsError);
  const selectedSessionId = useAppStore((state) => state.selectedSessionId);
  const selectedSessionSnapshot = useAppStore((state) => state.selectedSessionSnapshot);
  const actionHistory = useAppStore((state) => state.actionHistory);
  const actionHistoryState = useAppStore((state) => state.actionHistoryState);
  const actionHistoryRefreshing = useAppStore((state) => state.actionHistoryRefreshing);
  const actionHistoryLastLoadedAt = useAppStore((state) => state.actionHistoryLastLoadedAt);
  const actionHistoryError = useAppStore((state) => state.actionHistoryError);
  const debugEvents = useAppStore((state) => state.debugEvents);
  const debugStreamScope = useAppStore((state) => state.debugStreamScope);
  const streamStatus = useAppStore((state) => state.streamStatus);
  const streamCursor = useAppStore((state) => state.streamCursor);
  const streamError = useAppStore((state) => state.streamError);
  const streamInfo = useAppStore((state) => state.streamInfo);
  const selectSession = useAppStore((state) => state.selectSession);
  const syncSelectedSession = useAppStore((state) => state.syncSelectedSession);
  const resetActionHistory = useAppStore((state) => state.resetActionHistory);
  const setDebugStreamScope = useAppStore((state) => state.setDebugStreamScope);
  const setStreamStatus = useAppStore((state) => state.setStreamStatus);
  const setStreamReady = useAppStore((state) => state.setStreamReady);
  const appendDebugEvent = useAppStore((state) => state.appendDebugEvent);
  const setStreamError = useAppStore((state) => state.setStreamError);
  const resetDebugStream = useAppStore((state) => state.resetDebugStream);

  const liveSelectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? null;
  const selectedSession =
    liveSelectedSession ??
    (selectedSessionSnapshot?.id === selectedSessionId ? selectedSessionSnapshot : null);
  const selectedSessionMissing =
    selectedSessionId !== null && liveSelectedSession === null && selectedSession !== null;
  const effectiveStreamSessionId =
    debugStreamScope === 'selected' ? selectedSessionId ?? undefined : undefined;

  async function refreshSessions(options: { silent?: boolean } = {}) {
    useAppStore.getState().setSessionsLoading({ silent: options.silent });

    try {
      const response = await listSessions(100);
      startTransition(() => {
        useAppStore.getState().setSessions(response.items);
      });
    } catch (error) {
      useAppStore.getState().setSessionsError(toErrorMessage(error));
    }
  }

  async function loadActionHistory(sessionId: string, options: { silent?: boolean } = {}) {
    useAppStore.getState().setActionHistoryLoading({ silent: options.silent });

    try {
      const response = await getActionHistory(sessionId);

      if (useAppStore.getState().selectedSessionId !== sessionId) {
        return;
      }

      startTransition(() => {
        if (response.session) {
          syncSelectedSession(response.session);
        }
        useAppStore.getState().setActionHistory(response.items);
      });
    } catch (error) {
      if (useAppStore.getState().selectedSessionId === sessionId) {
        useAppStore.getState().setActionHistoryError(toErrorMessage(error));
      }
    }
  }

  useEffect(() => {
    void refreshSessions();

    const intervalId = window.setInterval(() => {
      void refreshSessions({ silent: true });
    }, 15_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      resetActionHistory();
      return;
    }

    void loadActionHistory(selectedSessionId);

    const intervalId = window.setInterval(() => {
      void loadActionHistory(selectedSessionId, { silent: true });
    }, 5_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [selectedSessionId]);

  useEffect(() => {
    let disposed = false;

    resetDebugStream();
    setStreamStatus('connecting');

    const eventSource = createDebugEventSource({
      sessionId: effectiveStreamSessionId,
    });

    eventSource.addEventListener('open', () => {
      if (disposed) {
        return;
      }
      setStreamStatus('connecting');
    });

    eventSource.addEventListener('ready', (event) => {
      if (disposed) {
        return;
      }

      startTransition(() => {
        setStreamReady(parseEventData<StreamReadyEvent>(event as MessageEvent<string>));
      });
    });

    eventSource.addEventListener('raw', (event) => {
      if (disposed) {
        return;
      }

      const parsed = parseEventData<RawDebugEvent>(event as MessageEvent<string>);

      if (!isUsefulRawEvent(parsed)) {
        return;
      }

      startTransition(() => {
        appendDebugEvent(parsed);
      });
    });

    eventSource.addEventListener('heartbeat', () => {
      if (disposed) {
        return;
      }
      setStreamStatus('open');
    });

    eventSource.onerror = () => {
      if (disposed) {
        return;
      }
      setStreamError('SSE connection dropped. EventSource will retry automatically.');
    };

    return () => {
      disposed = true;
      eventSource.close();
    };
  }, [
    appendDebugEvent,
    effectiveStreamSessionId,
    resetDebugStream,
    setStreamError,
    setStreamReady,
    setStreamStatus,
  ]);

  return (
    <AppShell
      selectedSessionId={selectedSessionId}
      sessionPanel={
        <SessionListPanel
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          state={sessionsState}
          refreshing={sessionsRefreshing}
          lastLoadedAt={sessionsLastLoadedAt}
          error={sessionsError}
          onRefresh={() => {
            void refreshSessions();
            if (selectedSessionId) {
              void loadActionHistory(selectedSessionId, { silent: true });
            }
          }}
          onSelect={selectSession}
          selectedSessionMissing={selectedSessionMissing}
        />
      }
      actionPanel={
        <ActionHistoryPanel
          session={selectedSession}
          selectedSessionId={selectedSessionId}
          sessionMissing={selectedSessionMissing}
          items={actionHistory}
          state={actionHistoryState}
          refreshing={actionHistoryRefreshing}
          lastLoadedAt={actionHistoryLastLoadedAt}
          error={actionHistoryError}
        />
      }
      debugPanel={
        <DebugStreamPanel
          events={debugEvents}
          status={streamStatus}
          cursor={streamCursor}
          error={streamError}
          info={streamInfo}
          scope={debugStreamScope}
          selectedSessionId={selectedSessionId}
          effectiveSessionId={effectiveStreamSessionId ?? null}
          onScopeChange={setDebugStreamScope}
        />
      }
    />
  );
}
