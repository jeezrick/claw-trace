import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { SessionMetadata, SessionSummary } from '../lib/api';
import type { LoadState } from '../store/app-store';

type SessionListPanelProps = {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  selectedSessionMissing: boolean;
  selectedWorkspaceId: string;
  state: LoadState;
  refreshing: boolean;
  lastLoadedAt: number | null;
  error: string | null;
  onRefresh: () => void;
  onSelect: (session: SessionSummary) => void;
};

type ViewportSnapshot = {
  workspaceId: string;
  itemCount: number;
  scrollTop: number;
  scrollHeight: number;
  stickToBottom: boolean;
  anchorSessionId: string | null;
  anchorOffset: number;
  firstSessionId: string | null;
  lastSessionId: string | null;
};

function formatTime(value: number | null) {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleString();
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getMetadata(metadata: SessionSummary['metadata']): SessionMetadata | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  return metadata as SessionMetadata;
}

export function SessionListPanel(props: SessionListPanelProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewportSnapshotRef = useRef<ViewportSnapshot | null>(null);
  const [, forceUpdate] = useState(0);

  const hasRunningSession = props.sessions.some((s) => s.status === 'running');

  useEffect(() => {
    if (!hasRunningSession) return;
    const interval = setInterval(() => forceUpdate((n) => n + 1), 1_000);
    return () => clearInterval(interval);
  }, [hasRunningSession]);

  function findAnchorItem(viewport: HTMLDivElement) {
    const itemElements = Array.from(
      viewport.querySelectorAll<HTMLElement>('[data-session-id]')
    );
    return (
      itemElements.find((el) => el.offsetTop + el.offsetHeight > viewport.scrollTop) ?? null
    );
  }

  function captureViewportSnapshot() {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const anchorItem = findAnchorItem(viewport);

    viewportSnapshotRef.current = {
      workspaceId: props.selectedWorkspaceId,
      itemCount: props.sessions.length,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      stickToBottom:
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 48,
      anchorSessionId: anchorItem?.dataset.sessionId ?? null,
      anchorOffset: anchorItem ? anchorItem.offsetTop - viewport.scrollTop : 0,
      firstSessionId: props.sessions[0]?.id ?? null,
      lastSessionId: props.sessions[props.sessions.length - 1]?.id ?? null,
    };
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const snap = viewportSnapshotRef.current;

    if (!viewport) return;

    if (snap && snap.workspaceId !== props.selectedWorkspaceId) {
      viewport.scrollTop = 0;
    } else if (
      snap &&
      snap.workspaceId === props.selectedWorkspaceId &&
      (props.sessions.length !== snap.itemCount ||
        props.sessions[0]?.id !== snap.firstSessionId ||
        props.sessions[props.sessions.length - 1]?.id !== snap.lastSessionId)
    ) {
      if (snap.stickToBottom) {
        viewport.scrollTop = viewport.scrollHeight;
      } else if (snap.anchorSessionId) {
        const anchorEl = viewport.querySelector<HTMLElement>(
          `[data-session-id="${CSS.escape(snap.anchorSessionId)}"]`
        );
        if (anchorEl) {
          viewport.scrollTop = Math.max(anchorEl.offsetTop - snap.anchorOffset, 0);
        } else {
          viewport.scrollTop = snap.scrollTop;
        }
      } else {
        viewport.scrollTop = snap.scrollTop;
      }
    }

    captureViewportSnapshot();
  }, [props.selectedWorkspaceId, props.sessions]);

  return (
    <div className="panel-content">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Step 1</p>
          <h2>
            Session list
            {props.state === 'loading' || props.refreshing ? (
              <span className="loading-spinner" aria-label="Loading" />
            ) : null}
          </h2>
        </div>
        <button type="button" className="secondary-button" onClick={props.onRefresh}>
          Refresh
        </button>
      </div>

      <div className="supporting-row">
        <span className="supporting-text">
          Workspace: <strong>{props.selectedWorkspaceId}</strong>
        </span>
        <span className="supporting-text">
          State: <strong>{props.state}</strong>
        </span>
        <span className="supporting-text">Count: {props.sessions.length}</span>
        <span className="supporting-text">Last sync: {formatTime(props.lastLoadedAt)}</span>
        {props.refreshing ? <span className="status-pill status-connecting">refreshing</span> : null}
        {props.selectedSessionMissing ? (
          <span className="status-pill status-stalled">selection retained</span>
        ) : null}
      </div>

      {props.error ? <p className="error-text">{props.error}</p> : null}
      {props.selectedSessionMissing ? (
        <p className="supporting-text">
          The selected session is missing from the latest workspace snapshot. The current selection
          is pinned until it reappears or you choose another session.
        </p>
      ) : null}

      <div
        ref={viewportRef}
        className="panel-viewport"
        onScroll={captureViewportSnapshot}
      >
        {props.sessions.length === 0 ? (
          <div className="empty-state">
            <p>No sessions were found for this agent workspace yet.</p>
            <p className="supporting-text">
              Switch workspace, wait for the next run, or check that `sessions.json` exists.
            </p>
          </div>
        ) : (
          <div className="session-list" role="list">
            {props.sessions.map((session) => {
              const metadata = getMetadata(session.metadata);
              const actionCount = metadata?.actionCount ?? null;
              const duration = session.startedAt
                ? session.status === 'running'
                  ? formatDuration(Date.now() - session.startedAt)
                  : formatDuration(session.updatedAt - session.startedAt)
                : null;

              return (
                <button
                  key={session.id}
                  type="button"
                  className="session-card"
                  aria-pressed={props.selectedSessionId === session.id}
                  data-session-id={session.id}
                  onClick={() => props.onSelect(session)}
                >
                  <div className="session-card-head">
                    <span className={`status-pill status-${session.status}`}>{session.status}</span>
                    <span className="supporting-text session-provider">
                      {metadata?.provider ?? 'unknown'} / {metadata?.chatType ?? 'unknown'}
                    </span>
                  </div>
                  <strong className="card-title">{session.title ?? session.id}</strong>
                  <span className="supporting-text session-id">{session.id}</span>
                  <span className="supporting-text">Updated {formatTime(session.updatedAt)}</span>
                  <span className="session-summary">
                    {session.lastActionSummary ?? 'No derived action summary yet.'}
                  </span>
                  {metadata?.firstUserText ? (
                    <span className="supporting-text session-first-user">
                      {metadata.firstUserText}
                    </span>
                  ) : null}
                  {(actionCount !== null || duration !== null) ? (
                    <div className="session-card-meta">
                      {actionCount !== null ? (
                        <span className="session-meta-count">{actionCount} actions</span>
                      ) : null}
                      {duration !== null ? (
                        <span className="session-meta-duration">{duration}</span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
