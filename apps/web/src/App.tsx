import { startTransition, useEffect, useMemo, useState } from 'react';

import { ActionHistoryPanel } from './components/ActionHistoryPanel';
import { AppShell } from './components/AppShell';
import { ChainPanel } from './components/ChainPanel';
import { DebugStreamPanel } from './components/DebugStreamPanel';
import { SessionListPanel } from './components/SessionListPanel';
import { TerminalMessagePanel } from './components/TerminalMessagePanel';
import {
  createDebugEventSource,
  getActionHistory,
  getSessionDetail,
  listSessions,
  listWorkspaces,
  parseEventData,
  type ActionHistoryUpdatedSsePayload,
  type AgentWorkspaceOption,
  type RawDebugEvent,
  type SessionUpdatedSsePayload,
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
  const sessionDetail = useAppStore((state) => state.sessionDetail);
  const sessionDetailState = useAppStore((state) => state.sessionDetailState);
  const sessionDetailRefreshing = useAppStore((state) => state.sessionDetailRefreshing);
  const sessionDetailLastLoadedAt = useAppStore((state) => state.sessionDetailLastLoadedAt);
  const sessionDetailError = useAppStore((state) => state.sessionDetailError);
  const selectedTerminalKey = useAppStore((state) => state.selectedTerminalKey);
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
  const workspaceTab = useAppStore((state) => state.workspaceTab);
  const selectSession = useAppStore((state) => state.selectSession);
  const patchSession = useAppStore((state) => state.patchSession);
  const removeSessionFromList = useAppStore((state) => state.removeSessionFromList);
  const setActionHistoryFromSse = useAppStore((state) => state.setActionHistoryFromSse);
  const syncSelectedSession = useAppStore((state) => state.syncSelectedSession);
  const setSessionDetailLoading = useAppStore((state) => state.setSessionDetailLoading);
  const setSessionDetail = useAppStore((state) => state.setSessionDetail);
  const setSessionDetailError = useAppStore((state) => state.setSessionDetailError);
  const resetSessionDetail = useAppStore((state) => state.resetSessionDetail);
  const selectTerminal = useAppStore((state) => state.selectTerminal);
  const resetActionHistory = useAppStore((state) => state.resetActionHistory);
  const setDebugStreamScope = useAppStore((state) => state.setDebugStreamScope);
  const setStreamStatus = useAppStore((state) => state.setStreamStatus);
  const setStreamReady = useAppStore((state) => state.setStreamReady);
  const appendDebugEvent = useAppStore((state) => state.appendDebugEvent);
  const setStreamError = useAppStore((state) => state.setStreamError);
  const resetDebugStream = useAppStore((state) => state.resetDebugStream);
  const setWorkspaceTab = useAppStore((state) => state.setWorkspaceTab);

  const [workspaceOptions, setWorkspaceOptions] = useState<AgentWorkspaceOption[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('main');

  const normalizedWorkspaceOptions = useMemo(() => {
    if (workspaceOptions.length > 0) {
      return workspaceOptions;
    }

    return [
      {
        id: selectedWorkspaceId,
        label: selectedWorkspaceId,
        sessionsDir: '',
        sessionsIndexFile: '',
        sessionCount: 0,
        isDefault: selectedWorkspaceId === 'main',
      },
    ];
  }, [selectedWorkspaceId, workspaceOptions]);

  const liveSelectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? null;
  const selectedSession =
    liveSelectedSession ??
    (selectedSessionSnapshot?.id === selectedSessionId ? selectedSessionSnapshot : null);
  const selectedSessionMissing =
    selectedSessionId !== null && liveSelectedSession === null && selectedSession !== null;
  const selectedTerminal =
    sessionDetail.find((terminal) => terminal.key === selectedTerminalKey) ?? null;
  const effectiveStreamSessionId =
    debugStreamScope === 'selected' ? selectedSessionId ?? undefined : undefined;

  async function refreshWorkspaces() {
    try {
      const response = await listWorkspaces();
      startTransition(() => {
        setWorkspaceOptions(response.items);
        setSelectedWorkspaceId((current) => {
          if (response.items.some((item) => item.id === current)) {
            return current;
          }

          return response.defaultWorkspaceId ?? response.items[0]?.id ?? 'main';
        });
      });
    } catch (_error) {
      startTransition(() => {
        setWorkspaceOptions([
          {
            id: 'main',
            label: 'main',
            sessionsDir: '',
            sessionsIndexFile: '',
            sessionCount: 0,
            isDefault: true,
          },
        ]);
      });
    }
  }

  async function refreshSessions(options: { silent?: boolean } = {}) {
    useAppStore.getState().setSessionsLoading({ silent: options.silent });

    try {
      const response = await listSessions(100, selectedWorkspaceId);
      startTransition(() => {
        useAppStore.getState().setSessions(response.items);
      });
    } catch (error) {
      useAppStore.getState().setSessionsError(toErrorMessage(error));
    }
  }

  async function loadSessionDetail(sessionId: string, options: { silent?: boolean } = {}) {
    setSessionDetailLoading({ silent: options.silent });

    try {
      const response = await getSessionDetail(sessionId, selectedWorkspaceId);

      if (useAppStore.getState().selectedSessionId !== sessionId) {
        return;
      }

      startTransition(() => {
        if (response.session) {
          syncSelectedSession(response.session);
        }
        setSessionDetail(response.terminalMessages);
      });
    } catch (error) {
      if (useAppStore.getState().selectedSessionId === sessionId) {
        setSessionDetailError(toErrorMessage(error));
      }
    }
  }

  async function loadActionHistory(sessionId: string, options: { silent?: boolean } = {}) {
    useAppStore.getState().setActionHistoryLoading({ silent: options.silent });

    try {
      const response = await getActionHistory(sessionId, 100, selectedWorkspaceId);

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
    void refreshWorkspaces();
  }, []);

  useEffect(() => {
    selectSession(null);
    resetDebugStream();
    void refreshSessions();
  }, [selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedSessionId) {
      resetSessionDetail();
      resetActionHistory();
      return;
    }

    void loadSessionDetail(selectedSessionId);
    void loadActionHistory(selectedSessionId);
  }, [selectedSessionId, selectedWorkspaceId]);

  useEffect(() => {
    let disposed = false;

    resetDebugStream();
    setStreamStatus('connecting');

    const eventSource = createDebugEventSource({
      sessionId: effectiveStreamSessionId,
      watchSessionId: selectedSessionId ?? undefined,
      workspace: selectedWorkspaceId,
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

      const readyEvent = parseEventData<StreamReadyEvent>(event as MessageEvent<string>);
      startTransition(() => {
        setStreamReady(readyEvent);
      });

      // On reconnect (resumeCursor > 0), re-sync to catch up on missed state
      // Re-sync on ready, but skip if data was just loaded (< 2s ago) to avoid double-fetch on init
      const { sessionsLastLoadedAt } = useAppStore.getState();
      const isStale = !sessionsLastLoadedAt || Date.now() - sessionsLastLoadedAt > 2_000;
      if (isStale) {
        void refreshSessions({ silent: true });
        const currentSessionId = useAppStore.getState().selectedSessionId;
        if (currentSessionId) {
          void loadActionHistory(currentSessionId, { silent: true });
        }
      }
    });

    eventSource.addEventListener('session_updated', (event) => {
      if (disposed) {
        return;
      }

      const payload = parseEventData<SessionUpdatedSsePayload>(event as MessageEvent<string>);
      startTransition(() => {
        if (payload.change === 'removed') {
          removeSessionFromList(payload.sessionId ?? '');
        } else if (payload.session) {
          patchSession(payload.session);
        }
      });
    });

    eventSource.addEventListener('action_history_updated', (event) => {
      if (disposed) {
        return;
      }

      const payload = parseEventData<ActionHistoryUpdatedSsePayload>(event as MessageEvent<string>);
      const currentSessionId = useAppStore.getState().selectedSessionId;
      if (payload.sessionId === currentSessionId) {
        startTransition(() => {
          setActionHistoryFromSse(payload.actions);
        });
      }
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
    patchSession,
    removeSessionFromList,
    resetDebugStream,
    selectedSessionId,
    selectedWorkspaceId,
    setActionHistoryFromSse,
    setStreamError,
    setStreamReady,
    setStreamStatus,
  ]);

  return (
    <AppShell
      selectedSessionId={selectedSessionId}
      selectedTerminalLabel={
        selectedTerminal
          ? `${selectedTerminal.pending ? 'Pending' : 'Reply'} #${selectedTerminal.ordinal}`
          : null
      }
      selectedWorkspaceId={selectedWorkspaceId}
      workspaceOptions={workspaceOptions}
      workspaceTab={workspaceTab}
      onWorkspaceChange={setSelectedWorkspaceId}
      onTabChange={setWorkspaceTab}
      sessionPanel={
        <SessionListPanel
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          selectedWorkspaceId={selectedWorkspaceId}
          state={sessionsState}
          refreshing={sessionsRefreshing}
          lastLoadedAt={sessionsLastLoadedAt}
          error={sessionsError}
          onRefresh={() => {
            void refreshWorkspaces();
            void refreshSessions();
            if (selectedSessionId) {
              void loadSessionDetail(selectedSessionId, { silent: true });
              void loadActionHistory(selectedSessionId, { silent: true });
            }
          }}
          onSelect={selectSession}
          selectedSessionMissing={selectedSessionMissing}
        />
      }
      mainPanel={
        <div className="workflow-grid">
          <section className="panel panel-terminal">
            <TerminalMessagePanel
              session={selectedSession}
              selectedSessionId={selectedSessionId}
              sessionMissing={selectedSessionMissing}
              items={sessionDetail}
              selectedTerminalKey={selectedTerminalKey}
              state={sessionDetailState}
              refreshing={sessionDetailRefreshing}
              lastLoadedAt={sessionDetailLastLoadedAt}
              error={sessionDetailError}
              onSelect={selectTerminal}
            />
          </section>
          <section className="panel panel-chain">
            <ChainPanel session={selectedSession} terminal={selectedTerminal} />
          </section>
        </div>
      }
      actionPanel={
        <section className="panel panel-detail-view">
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
        </section>
      }
      debugPanel={
        <section className="panel panel-detail-view">
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
        </section>
      }
    />
  );
}
