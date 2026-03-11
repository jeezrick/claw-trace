import type { ActionHistoryItem, SessionSummary } from '../lib/api';
import type { LoadState } from '../store/app-store';

type ActionHistoryPanelProps = {
  session: SessionSummary | null;
  items: ActionHistoryItem[];
  state: LoadState;
  refreshing: boolean;
  lastLoadedAt: number | null;
  error: string | null;
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

      <div className="supporting-row">
        <span className="supporting-text">
          State: <strong>{props.state}</strong>
        </span>
        <span className="supporting-text">Items: {props.items.length}</span>
        <span className="supporting-text">Last sync: {formatTime(props.lastLoadedAt)}</span>
        {props.refreshing ? <span className="status-pill status-connecting">refreshing</span> : null}
      </div>

      {props.error ? <p className="error-text">{props.error}</p> : null}

      {props.session && props.items.length === 0 ? (
        <div className="empty-state">
          <p>No normalized actions are stored for this session yet.</p>
          <p className="supporting-text">
            This usually means the source transcript is empty or the latest ingest pass has not seen it yet.
          </p>
        </div>
      ) : null}

      {props.items.length > 0 ? (
        <ol className="history-list">
          {props.items.map((item) => (
            <li key={item.eventId} className="history-item">
              <div className="history-head">
                <div className="history-title-block">
                  <span className={`status-pill status-${item.status ?? 'unknown'}`}>
                    {labelForKind(item.kind)}
                  </span>
                  <strong>{item.title}</strong>
                </div>
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
