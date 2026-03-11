import { create } from 'zustand';

import type {
  ActionHistoryItem,
  RawDebugEvent,
  SessionSummary,
  StreamReadyEvent,
} from '../lib/api';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
export type StreamStatus = 'idle' | 'connecting' | 'open' | 'error';

type AppState = {
  sessions: SessionSummary[];
  sessionsState: LoadState;
  sessionsRefreshing: boolean;
  sessionsLastLoadedAt: number | null;
  sessionsError: string | null;
  selectedSessionId: string | null;
  actionHistory: ActionHistoryItem[];
  actionHistoryState: LoadState;
  actionHistoryRefreshing: boolean;
  actionHistoryLastLoadedAt: number | null;
  actionHistoryError: string | null;
  debugEvents: RawDebugEvent[];
  streamStatus: StreamStatus;
  streamCursor: number | null;
  streamError: string | null;
  streamInfo: StreamReadyEvent | null;
  setSessionsLoading: (options?: { silent?: boolean }) => void;
  setSessions: (sessions: SessionSummary[]) => void;
  setSessionsError: (message: string) => void;
  selectSession: (sessionId: string | null) => void;
  setActionHistoryLoading: (options?: { silent?: boolean }) => void;
  setActionHistory: (items: ActionHistoryItem[]) => void;
  setActionHistoryError: (message: string) => void;
  resetActionHistory: () => void;
  setStreamStatus: (status: StreamStatus) => void;
  setStreamReady: (event: StreamReadyEvent) => void;
  appendDebugEvent: (event: RawDebugEvent) => void;
  setStreamError: (message: string) => void;
  resetDebugStream: () => void;
};

export const useAppStore = create<AppState>((set) => ({
  sessions: [],
  sessionsState: 'idle',
  sessionsRefreshing: false,
  sessionsLastLoadedAt: null,
  sessionsError: null,
  selectedSessionId: null,
  actionHistory: [],
  actionHistoryState: 'idle',
  actionHistoryRefreshing: false,
  actionHistoryLastLoadedAt: null,
  actionHistoryError: null,
  debugEvents: [],
  streamStatus: 'idle',
  streamCursor: null,
  streamError: null,
  streamInfo: null,

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
      const selectedStillExists = sessions.some((session) => session.id === state.selectedSessionId);

      return {
        sessions,
        sessionsState: 'ready',
        sessionsRefreshing: false,
        sessionsLastLoadedAt: Date.now(),
        sessionsError: null,
        selectedSessionId: selectedStillExists
          ? state.selectedSessionId
          : sessions[0]?.id ?? null,
      };
    }),

  setSessionsError: (message) =>
    set({
      sessionsState: 'error',
      sessionsRefreshing: false,
      sessionsError: message,
    }),

  selectSession: (sessionId) =>
    set({
      selectedSessionId: sessionId,
      actionHistory: [],
      actionHistoryState: 'idle',
      actionHistoryRefreshing: false,
      actionHistoryLastLoadedAt: null,
      actionHistoryError: null,
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
}));
