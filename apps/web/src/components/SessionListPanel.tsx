import type { SessionMetadata, SessionSummary } from '../lib/api';
import type { LoadState } from '../store/app-store';

type SessionListPanelProps = {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  state: LoadState;
  error: string | null;
  onRefresh: () => void;
  onSelect: (sessionId: string) => void;
};

function formatTime(value: number | null) {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleString();
}

function getMetadata(metadata: SessionSummary['metadata']): SessionMetadata | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  return metadata as SessionMetadata;
}

export function SessionListPanel(props: SessionListPanelProps) {
  return (
    <div className="panel-content">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Sessions</p>
          <h2>Session list</h2>
        </div>
        <button type="button" className="secondary-button" onClick={props.onRefresh}>
          Refresh
        </button>
      </div>

      <p className="supporting-text">
        State: <strong>{props.state}</strong>
      </p>

      {props.error ? <p className="error-text">{props.error}</p> : null}

      {props.sessions.length === 0 ? (
        <div className="empty-state">
          <p>No sessions were ingested into the v2 store yet.</p>
          <p className="supporting-text">
            Check `sessions.json` availability or wait for the next ingest pass.
          </p>
        </div>
      ) : (
        <div className="session-list" role="list">
          {props.sessions.map((session) => {
            const metadata = getMetadata(session.metadata);

            return (
              <button
                key={session.id}
                type="button"
                className="session-card"
                aria-pressed={props.selectedSessionId === session.id}
                onClick={() => props.onSelect(session.id)}
              >
                <div className="session-card-head">
                  <span className={`status-pill status-${session.status}`}>{session.status}</span>
                  <span className="supporting-text">
                    {metadata?.provider ?? 'unknown'} / {metadata?.chatType ?? 'unknown'}
                  </span>
                </div>
                <strong>{session.title ?? session.id}</strong>
                <span className="supporting-text">Updated {formatTime(session.updatedAt)}</span>
                <span className="session-summary">
                  {session.lastActionSummary ?? 'No derived action summary yet.'}
                </span>
                {metadata?.firstUserText ? (
                  <span className="supporting-text">{metadata.firstUserText}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
