import type { RawDebugEvent, StreamReadyEvent } from '../lib/api';
import type { StreamStatus } from '../store/app-store';

type DebugStreamPanelProps = {
  events: RawDebugEvent[];
  status: StreamStatus;
  cursor: number | null;
  error: string | null;
  info: StreamReadyEvent | null;
};

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
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
        <span className="supporting-text">
          {props.info?.liveTailReady ? 'Live tail enabled' : 'Placeholder stream contract only'}
        </span>
      </div>

      {props.error ? <p className="error-text">{props.error}</p> : null}

      {props.events.length === 0 ? (
        <div className="empty-state">
          <p>No raw debug events have been persisted for this selection yet.</p>
          <p className="supporting-text">
            The panel already uses the v2 SSE route and resume cursor contract.
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
              <pre className="payload-block">{formatJson(event.payload)}</pre>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
