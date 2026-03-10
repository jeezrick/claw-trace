import type { ActionHistoryItem, SessionSummary } from '../lib/api';
import type { LoadState } from '../store/app-store';

type ActionHistoryPanelProps = {
  session: SessionSummary | null;
  items: ActionHistoryItem[];
  state: LoadState;
  error: string | null;
};

function formatTime(value: number | null) {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleTimeString();
}

export function ActionHistoryPanel(props: ActionHistoryPanelProps) {
  return (
    <div className="panel-content">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Timeline</p>
          <h2>Action history</h2>
        </div>
        <span className={`status-pill status-${props.session?.status ?? 'unknown'}`}>
          {props.session?.status ?? 'unknown'}
        </span>
      </div>

      {props.session ? (
        <div className="supporting-block">
          <strong>{props.session.title ?? props.session.id}</strong>
          <span className="supporting-text">Updated {new Date(props.session.updatedAt).toLocaleString()}</span>
        </div>
      ) : (
        <div className="empty-state">
          <p>Select a session to inspect normalized action history.</p>
        </div>
      )}

      <p className="supporting-text">
        State: <strong>{props.state}</strong>
      </p>

      {props.error ? <p className="error-text">{props.error}</p> : null}

      {props.session && props.items.length === 0 ? (
        <div className="empty-state">
          <p>No normalized actions are stored for this session yet.</p>
          <p className="supporting-text">
            The panel is wired to the future SQLite read model and will stay mounted as data arrives.
          </p>
        </div>
      ) : null}

      {props.items.length > 0 ? (
        <ol className="history-list">
          {props.items.map((item) => (
            <li key={item.eventId} className="history-item">
              <div className="history-head">
                <strong>{item.title}</strong>
                <span className="supporting-text">
                  #{item.sequence} · {item.kind} · {formatTime(item.startedAt)}
                </span>
              </div>
              {item.summary ? <p>{item.summary}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
