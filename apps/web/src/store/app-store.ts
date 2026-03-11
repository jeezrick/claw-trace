import { create } from 'zustand';

import type {
  ActionHistoryItem,
  RawDebugEvent,
  SessionSummary,
  StreamReadyEvent,
  TerminalMessageItem,
} from '../lib/api';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
export type StreamStatus = 'idle' | 'connecting' | 'open' | 'error';
export type DebugStreamScope = 'selected' | 'all';
export type WorkspaceTab = 'main' | 'actions' | 'debug';

type TerminalSelectionSnapshot = {
  key: string;
  ordinal: number;
  pending: boolean;
};

type AppState = {
  sessions: SessionSummary[];
  sessionsState: LoadState;
  sessionsRefreshing: boolean;
  sessionsLastLoadedAt: number | null;
  sessionsError: string | null;
  selectedSessionId: string | null;
  selectedSessionSnapshot: SessionSummary | null;
  sessionDetail: TerminalMessageItem[];
  sessionDetailState: LoadState;
  sessionDetailRefreshing: boolean;
  sessionDetailLastLoadedAt: number | null;
  sessionDetailError: string | null;
  selectedTerminalKey: string | null;
  selectedTerminalSnapshot: TerminalSelectionSnapshot | null;
  actionHistory: ActionHistoryItem[];
  actionHistoryState: LoadState;
  actionHistoryRefreshing: boolean;
  actionHistoryLastLoadedAt: number | null;
  actionHistoryError: string | null;
  debugEvents: RawDebugEvent[];
  debugStreamScope: DebugStreamScope;
  streamStatus: StreamStatus;
  streamCursor: number | null;
  streamError: string | null;
  streamInfo: StreamReadyEvent | null;
  workspaceTab: WorkspaceTab;
  setSessionsLoading: (options?: { silent?: boolean }) => void;
  setSessions: (sessions: SessionSummary[]) => void;
  setSessionsError: (message: string) => void;
  selectSession: (session: SessionSummary | null) => void;
  syncSelectedSession: (session: SessionSummary | null) => void;
  setSessionDetailLoading: (options?: { silent?: boolean }) => void;
  setSessionDetail: (items: TerminalMessageItem[]) => void;
  setSessionDetailError: (message: string) => void;
  resetSessionDetail: () => void;
  selectTerminal: (terminal: TerminalMessageItem | null) => void;
  setActionHistoryLoading: (options?: { silent?: boolean }) => void;
  setActionHistory: (items: ActionHistoryItem[]) => void;
  setActionHistoryError: (message: string) => void;
  resetActionHistory: () => void;
  setDebugStreamScope: (scope: DebugStreamScope) => void;
  setStreamStatus: (status: StreamStatus) => void;
  setStreamReady: (event: StreamReadyEvent) => void;
  appendDebugEvent: (event: RawDebugEvent) => void;
  setStreamError: (message: string) => void;
  resetDebugStream: () => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
};

export const useAppStore = create<AppState>((set) => ({
  sessions: [],
  sessionsState: 'idle',
  sessionsRefreshing: false,
  sessionsLastLoadedAt: null,
  sessionsError: null,
  selectedSessionId: null,
  selectedSessionSnapshot: null,
  sessionDetail: [],
  sessionDetailState: 'idle',
  sessionDetailRefreshing: false,
  sessionDetailLastLoadedAt: null,
  sessionDetailError: null,
  selectedTerminalKey: null,
  selectedTerminalSnapshot: null,
  actionHistory: [],
  actionHistoryState: 'idle',
  actionHistoryRefreshing: false,
  actionHistoryLastLoadedAt: null,
  actionHistoryError: null,
  debugEvents: [],
  debugStreamScope: 'all',
  streamStatus: 'idle',
  streamCursor: null,
  streamError: null,
  streamInfo: null,
  workspaceTab: 'main',

  setSessionsLoading: (options) =>
    set((state) => {
      const silent = options?.silent === true && state.sessions.length > 0;

      return {
        sessionsState: silent ? state.sessionsState : 'loading',
        sessionsRefreshing: silent,
        sessionsError: null,
      };
    }),

  setSessions: (sessions) =>
    set((state) => {
      const liveSelectedSession = state.selectedSessionId
        ? sessions.find((session) => session.id === state.selectedSessionId) ?? null
        : null;
      const fallbackSelectedSession = state.selectedSessionId ? null : sessions[0] ?? null;

      return {
        sessions,
        sessionsState: 'ready',
        sessionsRefreshing: false,
        sessionsLastLoadedAt: Date.now(),
        sessionsError: null,
        selectedSessionId:
          state.selectedSessionId ?? fallbackSelectedSession?.id ?? null,
        selectedSessionSnapshot:
          liveSelectedSession ?? state.selectedSessionSnapshot ?? fallbackSelectedSession,
      };
    }),

  setSessionsError: (message) =>
    set({
      sessionsState: 'error',
      sessionsRefreshing: false,
      sessionsError: message,
    }),

  selectSession: (session) =>
    set((state) => {
      const sessionId = session?.id ?? null;

      if (sessionId === state.selectedSessionId) {
        return {
          selectedSessionSnapshot: session ?? state.selectedSessionSnapshot,
        };
      }

      return {
        selectedSessionId: sessionId,
        selectedSessionSnapshot: session,
        sessionDetail: [],
        sessionDetailState: 'idle',
        sessionDetailRefreshing: false,
        sessionDetailLastLoadedAt: null,
        sessionDetailError: null,
        selectedTerminalKey: null,
        selectedTerminalSnapshot: null,
        actionHistory: [],
        actionHistoryState: 'idle',
        actionHistoryRefreshing: false,
        actionHistoryLastLoadedAt: null,
        actionHistoryError: null,
      };
    }),

  syncSelectedSession: (session) =>
    set((state) => {
      if (!session || session.id !== state.selectedSessionId) {
        return state;
      }

      return {
        selectedSessionSnapshot: session,
      };
    }),

  setSessionDetailLoading: (options) =>
    set((state) => {
      const silent = options?.silent === true && state.sessionDetail.length > 0;

      return {
        sessionDetailState: silent ? state.sessionDetailState : 'loading',
        sessionDetailRefreshing: silent,
        sessionDetailError: null,
      };
    }),

  setSessionDetail: (items) =>
    set((state) => {
      const selectedByKey = state.selectedTerminalKey
        ? items.find((item) => item.key === state.selectedTerminalKey) ?? null
        : null;
      const selectedByOrdinal = state.selectedTerminalSnapshot
        ? items.find((item) => {
            return (
              item.ordinal === state.selectedTerminalSnapshot?.ordinal &&
              item.pending === state.selectedTerminalSnapshot?.pending
            );
          }) ??
          items.find((item) => item.ordinal === state.selectedTerminalSnapshot?.ordinal) ??
          null
        : null;
      const fallbackSelection =
        selectedByKey ?? selectedByOrdinal ?? items[items.length - 1] ?? null;

      return {
        sessionDetail: items,
        sessionDetailState: 'ready',
        sessionDetailRefreshing: false,
        sessionDetailLastLoadedAt: Date.now(),
        sessionDetailError: null,
        selectedTerminalKey: fallbackSelection?.key ?? null,
        selectedTerminalSnapshot: fallbackSelection
          ? {
              key: fallbackSelection.key,
              ordinal: fallbackSelection.ordinal,
              pending: fallbackSelection.pending,
            }
          : null,
      };
    }),

  setSessionDetailError: (message) =>
    set({
      sessionDetailState: 'error',
      sessionDetailRefreshing: false,
      sessionDetailError: message,
    }),

  resetSessionDetail: () =>
    set({
      sessionDetail: [],
      sessionDetailState: 'idle',
      sessionDetailRefreshing: false,
      sessionDetailLastLoadedAt: null,
      sessionDetailError: null,
      selectedTerminalKey: null,
      selectedTerminalSnapshot: null,
    }),

  selectTerminal: (terminal) =>
    set({
      selectedTerminalKey: terminal?.key ?? null,
      selectedTerminalSnapshot: terminal
        ? {
            key: terminal.key,
            ordinal: terminal.ordinal,
            pending: terminal.pending,
          }
        : null,
    }),

  setActionHistoryLoading: (options) =>
    set((state) => {
      const silent = options?.silent === true && state.actionHistory.length > 0;

      return {
        actionHistoryState: silent ? state.actionHistoryState : 'loading',
        actionHistoryRefreshing: silent,
        actionHistoryError: null,
      };
    }),

  setActionHistory: (items) =>
    set({
      actionHistory: items,
      actionHistoryState: 'ready',
      actionHistoryRefreshing: false,
      actionHistoryLastLoadedAt: Date.now(),
      actionHistoryError: null,
    }),

  setActionHistoryError: (message) =>
    set({
      actionHistoryState: 'error',
      actionHistoryRefreshing: false,
      actionHistoryError: message,
    }),

  resetActionHistory: () =>
    set({
      actionHistory: [],
      actionHistoryState: 'idle',
      actionHistoryRefreshing: false,
      actionHistoryLastLoadedAt: null,
      actionHistoryError: null,
    }),

  setDebugStreamScope: (scope) =>
    set({
      debugStreamScope: scope,
    }),

  setStreamStatus: (status) =>
    set({
      streamStatus: status,
      streamError: status === 'error' ? 'Stream connection is unstable.' : null,
    }),

  setStreamReady: (event) =>
    set({
      streamStatus: 'open',
      streamCursor: event.resumeCursor,
      streamError: null,
      streamInfo: event,
    }),

  appendDebugEvent: (event) =>
    set((state) => {
      const lastCursor = state.debugEvents[state.debugEvents.length - 1]?.streamCursor ?? 0;

      if (event.streamCursor <= lastCursor) {
        return state;
      }

      return {
        debugEvents: [...state.debugEvents, event].slice(-300),
        streamStatus: 'open',
        streamCursor: event.streamCursor,
        streamError: null,
      };
    }),

  setStreamError: (message) =>
    set({
      streamStatus: 'error',
      streamError: message,
    }),

  resetDebugStream: () =>
    set({
      debugEvents: [],
      streamStatus: 'idle',
      streamCursor: null,
      streamError: null,
      streamInfo: null,
    }),

  setWorkspaceTab: (tab) =>
    set({
      workspaceTab: tab,
    }),
}));
