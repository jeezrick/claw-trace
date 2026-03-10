import type { RawDebugEvent, StreamReadyEvent } from '../lib/api';
import type { StreamStatus } from '../store/app-store';

type DebugStreamPanelProps = {
  events: RawDebugEvent[];
  status: StreamStatus;
  cursor: number | null;
  error: string | null;
  info: StreamReadyEvent | null;
  selectedSessionId: string | null;
};

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2) ?? String(value);
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
  return (
    <div className="panel-content">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Realtime</p>
          <h2>Debug stream</h2>
        </div>
        <span className={`status-pill status-${props.status}`}>{props.status}</span>
      </div>

      <div className="supporting-block">
        <span className="supporting-text">Cursor {props.cursor ?? 0}</span>
        <span className="supporting-text">Latest {props.info?.latestCursor ?? props.cursor ?? 0}</span>
        <span className="supporting-text">Selected session {props.selectedSessionId ?? 'none'}</span>
      </div>

      {props.error ? <p className="error-text">{props.error}</p> : null}

      {props.events.length === 0 ? (
        <div className="empty-state">
          <p>No raw debug events have been replayed yet.</p>
          <p className="supporting-text">
            This panel follows the global raw stream and resumes from the last DB cursor.
          </p>
        </div>
      ) : (
        <div className="debug-stream-list">
          {props.events.map((event) => (
            <article key={event.eventId} className="debug-entry">
              <div className="debug-entry-head">
                <strong>{event.kind}</strong>
                <span className="supporting-text">
                  #{event.streamCursor} · {new Date(event.eventTs).toLocaleTimeString()}
                </span>
              </div>
              <span className="supporting-text">
                session {event.sessionId ?? 'n/a'} · run {event.runId ?? 'n/a'}
              </span>
              <pre className="payload-block">{previewEvent(event)}</pre>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
