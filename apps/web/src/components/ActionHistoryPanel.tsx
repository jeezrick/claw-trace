import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ActionHistoryItem, SessionSummary } from '../lib/api';
import type { LoadState } from '../store/app-store';

type ActionHistoryPanelProps = {
  session: SessionSummary | null;
  selectedSessionId: string | null;
  sessionMissing: boolean;
  items: ActionHistoryItem[];
  state: LoadState;
  refreshing: boolean;
  lastLoadedAt: number | null;
  error: string | null;
};

type ViewportSnapshot = {
  sessionKey: string | null;
  itemCount: number;
  scrollTop: number;
  scrollHeight: number;
  stickToBottom: boolean;
  anchorEventId: string | null;
  anchorOffset: number;
  firstEventId: string | null;
  lastEventId: string | null;
};

function formatTime(value: number | null) {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleTimeString();
}

function labelForKind(kind: ActionHistoryItem['kind']) {
  switch (kind) {
    case 'user':
      return 'user';
    case 'think':
      return 'think';
    case 'toolCall':
      return 'tool';
    case 'toolResult':
      return 'result';
    case 'reply':
      return 'reply';
    case 'assistantError':
      return 'error';
    case 'assistantText':
      return 'assistant';
    default:
      return kind;
  }
}

export function ActionHistoryPanel(props: ActionHistoryPanelProps) {
  const activeSessionKey = props.selectedSessionId ?? props.session?.id ?? null;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewportSnapshotRef = useRef<ViewportSnapshot | null>(null);
  const previousItemsRef = useRef<{
    sessionKey: string | null;
    eventIds: string[];
  }>({
    sessionKey: null,
    eventIds: [],
  });
  const highlightTimersRef = useRef<Map<string, number>>(new Map());
  const [highlightedEventIds, setHighlightedEventIds] = useState<string[]>([]);

  function findAnchorItem(viewport: HTMLDivElement) {
    const itemElements = Array.from(
      viewport.querySelectorAll<HTMLElement>('[data-history-event-id]')
    );

    return (
      itemElements.find((itemElement) => {
        return itemElement.offsetTop + itemElement.offsetHeight > viewport.scrollTop;
      }) ?? null
    );
  }

  function captureViewportSnapshot() {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const anchorItem = findAnchorItem(viewport);

    viewportSnapshotRef.current = {
      sessionKey: activeSessionKey,
      itemCount: props.items.length,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      stickToBottom:
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 48,
      anchorEventId: anchorItem?.dataset.historyEventId ?? null,
      anchorOffset: anchorItem ? anchorItem.offsetTop - viewport.scrollTop : 0,
      firstEventId: props.items[0]?.eventId ?? null,
      lastEventId: props.items[props.items.length - 1]?.eventId ?? null,
    };
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const previousSnapshot = viewportSnapshotRef.current;

    if (!viewport) {
      return;
    }

    if (previousSnapshot && previousSnapshot.sessionKey !== activeSessionKey) {
      viewport.scrollTop = 0;
    } else if (
      previousSnapshot &&
      previousSnapshot.sessionKey === activeSessionKey &&
      (props.items.length !== previousSnapshot.itemCount ||
        props.items[0]?.eventId !== previousSnapshot.firstEventId ||
        props.items[props.items.length - 1]?.eventId !== previousSnapshot.lastEventId)
    ) {
      if (previousSnapshot.stickToBottom) {
        viewport.scrollTop = viewport.scrollHeight;
      } else if (previousSnapshot.anchorEventId) {
        const anchorItem = Array.from(
          viewport.querySelectorAll<HTMLElement>('[data-history-event-id]')
        ).find((itemElement) => {
          return itemElement.dataset.historyEventId === previousSnapshot.anchorEventId;
        });

        if (anchorItem) {
          viewport.scrollTop = Math.max(
            anchorItem.offsetTop - previousSnapshot.anchorOffset,
            0
          );
        } else {
          viewport.scrollTop = previousSnapshot.scrollTop;
        }
      } else {
        viewport.scrollTop = previousSnapshot.scrollTop;
      }
    }

    captureViewportSnapshot();
  }, [activeSessionKey, props.items]);

  useEffect(() => {
    return () => {
      highlightTimersRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      highlightTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const previous = previousItemsRef.current;
    const currentEventIds = props.items.map((item) => item.eventId);

    if (previous.sessionKey !== activeSessionKey) {
      highlightTimersRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      highlightTimersRef.current.clear();
      setHighlightedEventIds([]);
      previousItemsRef.current = {
        sessionKey: activeSessionKey,
        eventIds: currentEventIds,
      };
      return;
    }

    if (previous.eventIds.length === 0) {
      previousItemsRef.current = {
        sessionKey: activeSessionKey,
        eventIds: currentEventIds,
      };
      return;
    }

    const previousEventIds = new Set(previous.eventIds);
    const nextEventIds = props.items
      .filter((item) => !previousEventIds.has(item.eventId))
      .map((item) => item.eventId);

    if (nextEventIds.length > 0) {
      setHighlightedEventIds((currentIds) => {
        const mergedIds = new Set(currentIds);

        nextEventIds.forEach((eventId) => {
          mergedIds.add(eventId);
        });

        return Array.from(mergedIds);
      });

      nextEventIds.forEach((eventId) => {
        const existingTimeoutId = highlightTimersRef.current.get(eventId);

        if (typeof existingTimeoutId === 'number') {
          window.clearTimeout(existingTimeoutId);
        }

        const timeoutId = window.setTimeout(() => {
          highlightTimersRef.current.delete(eventId);
          setHighlightedEventIds((currentIds) =>
            currentIds.filter((currentId) => currentId !== eventId)
          );
        }, 3_500);

        highlightTimersRef.current.set(eventId, timeoutId);
      });
    }

    previousItemsRef.current = {
      sessionKey: activeSessionKey,
      eventIds: currentEventIds,
    };
  }, [activeSessionKey, props.items]);

  const isLoading = props.state === 'loading' && props.items.length === 0;
  const showEmptyState =
    props.session && props.items.length === 0 && !isLoading && !props.error;

  return (
    <div className="panel-content">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Session detail</p>
          <h2>
            Action history
            {props.refreshing || props.state === 'loading' ? (
              <span className="loading-spinner" aria-label="Loading" />
            ) : null}
          </h2>
        </div>
        <span className={`status-pill status-${props.session?.status ?? 'unknown'}`}>
          {props.session?.status ?? 'unknown'}
        </span>
      </div>

      {props.session ? (
        <div className="supporting-block supporting-block-start">
          <strong className="card-title">{props.session.title ?? props.session.id}</strong>
          <span className="supporting-text session-id">{props.session.id}</span>
          <span className="supporting-text">
            Updated {new Date(props.session.updatedAt).toLocaleString()}
          </span>
          {props.sessionMissing ? (
            <span className="supporting-text">
              Latest session snapshot is temporarily missing this row. Keeping the current panel
              pinned while ingest catches up.
            </span>
          ) : null}
        </div>
      ) : (
        <div className="empty-state">
          <p>Select a session to inspect normalized action history.</p>
        </div>
      )}

      <div className="supporting-row">
        <span className="supporting-text">
          State: <strong>{props.state}</strong>
        </span>
        <span className="supporting-text">Items: {props.items.length}</span>
        <span className="supporting-text">Last sync: {formatTime(props.lastLoadedAt)}</span>
        {props.refreshing ? <span className="status-pill status-connecting">refreshing</span> : null}
        {highlightedEventIds.length > 0 ? (
          <span className="status-pill status-open">{highlightedEventIds.length} new</span>
        ) : null}
      </div>

      {props.error ? <p className="error-text">{props.error}</p> : null}

      <div
        ref={viewportRef}
        className="panel-viewport history-viewport"
        onScroll={captureViewportSnapshot}
      >
        {isLoading ? (
          <div className="empty-state">
            <p>Loading action history…</p>
            <p className="supporting-text">
              Keeping the selected session pinned while the latest normalized actions arrive.
            </p>
          </div>
        ) : null}

        {showEmptyState ? (
          <div className="empty-state">
            <p>No normalized actions are stored for this session yet.</p>
            <p className="supporting-text">
              This usually means the source transcript is empty or the latest ingest pass has not
              seen it yet.
            </p>
          </div>
        ) : null}

        {props.items.length > 0 ? (
          <ol className="history-list">
            {props.items.map((item) => (
              <li
                key={item.eventId}
                data-history-event-id={item.eventId}
                className={`history-item ${
                  highlightedEventIds.includes(item.eventId) ? 'history-item-new' : ''
                }`}
              >
                <div className="history-head">
                  <div className="history-title-block">
                    <span className={`status-pill status-${item.status ?? 'unknown'}`}>
                      {labelForKind(item.kind)}
                    </span>
                    <strong className="card-title">{item.title}</strong>
                  </div>
                  <span className="supporting-text">
                    #{item.sequence} · {item.kind} · {formatTime(item.startedAt)}
                  </span>
                </div>
                {item.summary ? <p className="history-summary">{item.summary}</p> : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
