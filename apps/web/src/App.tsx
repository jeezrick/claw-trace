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
  const sessionsError = useAppStore((state) => state.sessionsError);
  const selectedSessionId = useAppStore((state) => state.selectedSessionId);
  const actionHistory = useAppStore((state) => state.actionHistory);
  const actionHistoryState = useAppStore((state) => state.actionHistoryState);
  const actionHistoryError = useAppStore((state) => state.actionHistoryError);
  const debugEvents = useAppStore((state) => state.debugEvents);
  const streamStatus = useAppStore((state) => state.streamStatus);
  const streamCursor = useAppStore((state) => state.streamCursor);
  const streamError = useAppStore((state) => state.streamError);
  const streamInfo = useAppStore((state) => state.streamInfo);
  const setSessionsLoading = useAppStore((state) => state.setSessionsLoading);
  const setSessions = useAppStore((state) => state.setSessions);
  const setSessionsError = useAppStore((state) => state.setSessionsError);
  const selectSession = useAppStore((state) => state.selectSession);
  const setActionHistoryLoading = useAppStore((state) => state.setActionHistoryLoading);
  const setActionHistory = useAppStore((state) => state.setActionHistory);
  const setActionHistoryError = useAppStore((state) => state.setActionHistoryError);
  const resetActionHistory = useAppStore((state) => state.resetActionHistory);
  const setStreamStatus = useAppStore((state) => state.setStreamStatus);
  const setStreamReady = useAppStore((state) => state.setStreamReady);
  const appendDebugEvent = useAppStore((state) => state.appendDebugEvent);
  const setStreamError = useAppStore((state) => state.setStreamError);
  const resetDebugStream = useAppStore((state) => state.resetDebugStream);

  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? null;

  async function refreshSessions() {
    setSessionsLoading();

    try {
      const response = await listSessions(100);
      startTransition(() => {
        setSessions(response.items);
      });
    } catch (error) {
      setSessionsError(toErrorMessage(error));
    }
  }

  useEffect(() => {
    void refreshSessions();

    const intervalId = window.setInterval(() => {
      void refreshSessions();
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

    let disposed = false;

    setActionHistoryLoading();

    void getActionHistory(selectedSessionId)
      .then((response) => {
        if (disposed) {
          return;
        }

        startTransition(() => {
          setActionHistory(response.items);
        });
      })
      .catch((error) => {
        if (!disposed) {
          setActionHistoryError(toErrorMessage(error));
        }
      });

    return () => {
      disposed = true;
    };
  }, [selectedSessionId]);

  useEffect(() => {
    resetDebugStream();
    setStreamStatus('connecting');

    const eventSource = createDebugEventSource();

    eventSource.addEventListener('open', () => {
      setStreamStatus('connecting');
    });

    eventSource.addEventListener('ready', (event) => {
      startTransition(() => {
        setStreamReady(parseEventData<StreamReadyEvent>(event as MessageEvent<string>));
      });
    });

    eventSource.addEventListener('raw', (event) => {
      const parsed = parseEventData<RawDebugEvent>(event as MessageEvent<string>);

      if (!isUsefulRawEvent(parsed)) {
        return;
      }

      startTransition(() => {
        appendDebugEvent(parsed);
      });
    });

    eventSource.addEventListener('heartbeat', () => {
      setStreamStatus('open');
    });

    eventSource.onerror = () => {
      setStreamError('SSE connection dropped. EventSource will retry automatically.');
    };

    return () => {
      eventSource.close();
    };
  }, []);

  return (
    <AppShell
      selectedSessionId={selectedSessionId}
      sessionPanel={
        <SessionListPanel
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          state={sessionsState}
          error={sessionsError}
          onRefresh={() => {
            void refreshSessions();
          }}
          onSelect={selectSession}
        />
      }
      actionPanel={
        <ActionHistoryPanel
          session={selectedSession}
          items={actionHistory}
          state={actionHistoryState}
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
          selectedSessionId={selectedSessionId}
        />
      }
    />
  );
}
