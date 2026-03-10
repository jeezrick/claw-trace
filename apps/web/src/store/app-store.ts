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
  sessionsError: string | null;
  selectedSessionId: string | null;
  actionHistory: ActionHistoryItem[];
  actionHistoryState: LoadState;
  actionHistoryError: string | null;
  debugEvents: RawDebugEvent[];
  streamStatus: StreamStatus;
  streamCursor: number | null;
  streamError: string | null;
  streamInfo: StreamReadyEvent | null;
  setSessionsLoading: () => void;
  setSessions: (sessions: SessionSummary[]) => void;
  setSessionsError: (message: string) => void;
  selectSession: (sessionId: string | null) => void;
  setActionHistoryLoading: () => void;
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
  sessionsError: null,
  selectedSessionId: null,
  actionHistory: [],
  actionHistoryState: 'idle',
  actionHistoryError: null,
  debugEvents: [],
  streamStatus: 'idle',
  streamCursor: null,
  streamError: null,
  streamInfo: null,

  setSessionsLoading: () =>
    set({
      sessionsState: 'loading',
      sessionsError: null,
    }),

  setSessions: (sessions) =>
    set((state) => {
      const selectedStillExists = sessions.some((session) => session.id === state.selectedSessionId);

      return {
        sessions,
        sessionsState: 'ready',
        sessionsError: null,
        selectedSessionId: selectedStillExists
          ? state.selectedSessionId
          : sessions[0]?.id ?? null,
      };
    }),

  setSessionsError: (message) =>
    set({
      sessionsState: 'error',
      sessionsError: message,
    }),

  selectSession: (sessionId) =>
    set({
      selectedSessionId: sessionId,
      actionHistory: [],
      actionHistoryState: 'idle',
      actionHistoryError: null,
      debugEvents: [],
      streamStatus: 'idle',
      streamCursor: null,
      streamError: null,
      streamInfo: null,
    }),

  setActionHistoryLoading: () =>
    set({
      actionHistoryState: 'loading',
      actionHistoryError: null,
    }),

  setActionHistory: (items) =>
    set({
      actionHistory: items,
      actionHistoryState: 'ready',
      actionHistoryError: null,
    }),

  setActionHistoryError: (message) =>
    set({
      actionHistoryState: 'error',
      actionHistoryError: message,
    }),

  resetActionHistory: () =>
    set({
      actionHistory: [],
      actionHistoryState: 'idle',
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
    set((state) => ({
      debugEvents: [...state.debugEvents, event].slice(-200),
      streamStatus: 'open',
      streamCursor: event.streamCursor,
      streamError: null,
    })),

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
