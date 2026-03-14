import { useLayoutEffect, useRef, useState } from 'react';

import type { RawDebugEvent, StreamReadyEvent } from '../lib/api';
import type { DebugStreamScope, StreamStatus } from '../store/app-store';

type DebugStreamPanelProps = {
  events: RawDebugEvent[];
  status: StreamStatus;
  cursor: number | null;
  error: string | null;
  info: StreamReadyEvent | null;
  scope: DebugStreamScope;
  selectedSessionId: string | null;
  effectiveSessionId: string | null;
  onScopeChange: (scope: DebugStreamScope) => void;
};

type ViewportSnapshot = {
  eventCount: number;
  scrollTop: number;
  scrollHeight: number;
  stickToBottom: boolean;
  scope: DebugStreamScope;
};

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2) ?? String(value);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function colorizeJson(value: unknown): string {
  const json = escapeHtml(formatJson(value));
  return json.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/g,
    (_, key, colon, str, scalarColon, scalar) => {
      if (key !== undefined) return `<span class="payload-key">${key}</span>${colon}`;
      if (str !== undefined) return `<span class="payload-str">${str}</span>`;
      return `${scalarColon}<span class="payload-num">${scalar}</span>`;
    }
  );
}

function previewEvent(event: RawDebugEvent) {
  const payload =
    event.payload && typeof event.payload === 'object'
      ? (event.payload as Record<string, unknown>)
      : null;

  if (event.kind === 'assistant_message_end') {
    return typeof payload?.rawText === 'string' && payload.rawText
      ? payload.rawText
      : 'assistant_message_end';
  }

  if (event.kind === 'assistant_thinking_stream') {
    return typeof payload?.content === 'string' && payload.content
      ? payload.content
      : 'assistant_thinking_stream';
  }

  if (typeof payload?.rawLine === 'string' && payload.rawLine) {
    return payload.rawLine;
  }

  return formatJson(event.payload);
}

export function DebugStreamPanel(props: DebugStreamPanelProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const snapshotRef = useRef<ViewportSnapshot | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const selectedScopeWaiting = props.scope === 'selected' && props.selectedSessionId === null;

  function captureSnapshot() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    snapshotRef.current = {
      eventCount: props.events.length,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      stickToBottom:
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 48,
      scope: props.scope,
    };
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const snap = snapshotRef.current;

    if (!viewport) return;

    if (!snap || snap.scope !== props.scope) {
      // First render or scope change: scroll to bottom
      viewport.scrollTop = viewport.scrollHeight;
    } else if (props.events.length !== snap.eventCount) {
      if (snap.stickToBottom) {
        viewport.scrollTop = viewport.scrollHeight;
      }
      // If not at bottom, leave position unchanged (let user scroll back up)
    }

    captureSnapshot();
  }, [props.events, props.scope]);

  function toggleExpand(eventId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }

  return (
    <div className="panel-content">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Realtime</p>
          <h2>Debug stream</h2>
        </div>
        <span className={`status-pill status-${props.status}`}>{props.status}</span>
      </div>

      <div className="segmented-control" role="group" aria-label="Debug stream scope">
        <button
          type="button"
          className={`segment-button ${props.scope === 'selected' ? 'is-active' : ''}`}
          aria-pressed={props.scope === 'selected'}
          onClick={() => props.onScopeChange('selected')}
        >
          Selected session
        </button>
        <button
          type="button"
          className={`segment-button ${props.scope === 'all' ? 'is-active' : ''}`}
          aria-pressed={props.scope === 'all'}
          onClick={() => props.onScopeChange('all')}
        >
          All sessions
        </button>
      </div>

      <div className="supporting-block">
        <span className="supporting-text">Cursor {props.cursor ?? 0}</span>
        <span className="supporting-text">Latest {props.info?.latestCursor ?? props.cursor ?? 0}</span>
        <span className="supporting-text">
          Scope {props.scope === 'selected' ? 'selected session' : 'all sessions'}
        </span>
        <span className="supporting-text">
          Active filter {props.effectiveSessionId ?? 'none'}
        </span>
      </div>

      {props.error ? <p className="error-text">{props.error}</p> : null}
      {selectedScopeWaiting ? (
        <p className="supporting-text">
          Selected-session scope is armed, but no session is selected yet. Showing all sessions
          until you choose one.
        </p>
      ) : null}
      {props.scope === 'selected' && props.effectiveSessionId ? (
        <p className="supporting-text">
          Best-effort filtering is active for session <code>{props.effectiveSessionId}</code>.
          Raw events without a resolved `sessionId` remain visible only in all-sessions mode.
        </p>
      ) : null}

      <div
        ref={viewportRef}
        className="panel-viewport"
        onScroll={captureSnapshot}
      >
        {props.events.length === 0 ? (
          <div className="empty-state">
            <p>No raw debug events have been replayed yet.</p>
            <p className="supporting-text">
              {props.scope === 'selected' && props.effectiveSessionId
                ? 'This panel is replaying the selected session tail from SQLite-backed SSE.'
                : 'This panel follows the global raw stream and resumes from the last DB cursor.'}
            </p>
          </div>
        ) : (
          <div className="debug-stream-list">
            {props.events.map((event) => {
              const preview = previewEvent(event);
              const rawJson =
                event.payload !== null && event.payload !== undefined
                  ? formatJson(event.payload)
                  : null;
              const isRawJsonPreview = rawJson !== null && preview === rawJson;
              const isExpanded = expandedIds.has(event.eventId);

              return (
                <article
                  key={event.eventId}
                  data-debug-event-id={event.streamCursor}
                  className="debug-entry"
                >
                  <div className="debug-entry-head">
                    <strong className="card-title">{event.kind}</strong>
                    <span className="supporting-text">
                      #{event.streamCursor} · {new Date(event.eventTs).toLocaleTimeString()}
                    </span>
                  </div>
                  <span className="supporting-text">
                    session {event.sessionId ?? 'n/a'} · run {event.runId ?? 'n/a'}
                  </span>

                  {/* Preview text – only when it differs from raw JSON */}
                  {!isRawJsonPreview ? (
                    <pre className="payload-block">{preview}</pre>
                  ) : null}

                  {/* Colorized JSON payload – always collapsible */}
                  {rawJson !== null ? (
                    <div className={`payload-collapsible ${isExpanded ? '' : 'is-collapsed'}`}>
                      <pre
                        className="payload-block"
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: colorizeJson(event.payload) }}
                      />
                      <button
                        type="button"
                        className="payload-toggle"
                        onClick={() => toggleExpand(event.eventId)}
                      >
                        {isExpanded ? '▲ Collapse' : '▶ Raw JSON'}
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
