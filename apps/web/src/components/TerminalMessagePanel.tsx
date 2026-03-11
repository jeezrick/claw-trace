import { useEffect, useRef } from 'react';

import type { SessionSummary, TerminalMessageItem } from '../lib/api';
import type { LoadState } from '../store/app-store';

type TerminalMessagePanelProps = {
  session: SessionSummary | null;
  selectedSessionId: string | null;
  sessionMissing: boolean;
  items: TerminalMessageItem[];
  selectedTerminalKey: string | null;
  state: LoadState;
  refreshing: boolean;
  lastLoadedAt: number | null;
  error: string | null;
  onSelect: (terminal: TerminalMessageItem) => void;
};

function formatTime(value: number | null) {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleTimeString();
}

function summarizeTools(terminal: TerminalMessageItem) {
  if (terminal.summary.tools.length === 0) {
    return 'text-only chain';
  }

  const [firstTool, secondTool, ...rest] = terminal.summary.tools;
  return [firstTool, secondTool].filter(Boolean).join(', ') + (rest.length > 0 ? ` +${rest.length}` : '');
}

export function TerminalMessagePanel(props: TerminalMessagePanelProps) {
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);
  const isLoading = props.state === 'loading' && props.items.length === 0;
  const showEmptyState = props.session && props.items.length === 0 && !isLoading && !props.error;

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [props.selectedSessionId, props.selectedTerminalKey]);

  return (
    <div className="panel-content">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Step 2</p>
          <h2>Terminal messages</h2>
        </div>
        <span className="status-pill status-open">{props.items.length} windows</span>
      </div>

      {props.session ? (
        <div className="supporting-block supporting-block-start">
          <strong className="card-title">{props.session.title ?? props.session.id}</strong>
          <span className="supporting-text session-id">{props.session.id}</span>
          <span className="supporting-text">
            Each card represents one terminal reply window derived from the normalized action
            stream.
          </span>
          {props.sessionMissing ? (
            <span className="supporting-text">
              The selected session is temporarily missing from the latest ingest snapshot, but this
              terminal selection remains pinned.
            </span>
          ) : null}
        </div>
      ) : (
        <div className="empty-state">
          <p>Select a session to inspect its terminal messages.</p>
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

      <div className="panel-viewport">
        {isLoading ? (
          <div className="empty-state">
            <p>Loading terminal messages…</p>
            <p className="supporting-text">
              The most recent assistant reply windows are being rebuilt from the session detail
              route.
            </p>
          </div>
        ) : null}

        {showEmptyState ? (
          <div className="empty-state">
            <p>No terminal reply windows are stored for this session yet.</p>
            <p className="supporting-text">
              This usually means the session has not produced a terminal assistant reply window yet.
            </p>
          </div>
        ) : null}

        {props.items.length > 0 ? (
          <div className="terminal-list" role="list">
            {props.items.map((terminal) => {
              const isSelected = props.selectedTerminalKey === terminal.key;

              return (
                <button
                  key={terminal.key}
                  ref={isSelected ? selectedItemRef : null}
                  type="button"
                  className="terminal-card"
                  aria-pressed={isSelected}
                  onClick={() => props.onSelect(terminal)}
                >
                  <div className="terminal-card-head">
                    <div className="history-title-block">
                      <span
                        className={`status-pill ${
                          terminal.pending ? 'status-stalled' : 'status-open'
                        }`}
                      >
                        {terminal.pending ? 'pending' : 'reply'}
                      </span>
                      <strong className="card-title">Window #{terminal.ordinal}</strong>
                    </div>
                    <span className="supporting-text">{formatTime(terminal.timestamp)}</span>
                  </div>

                  <p className="terminal-preview">{terminal.preview}</p>

                  {terminal.triggerUserText ? (
                    <p className="supporting-text terminal-trigger">
                      Trigger: {terminal.triggerUserText}
                    </p>
                  ) : null}

                  <div className="supporting-row">
                    <span className="supporting-text">
                      Seq {terminal.startSequence}-{terminal.endSequence}
                    </span>
                    <span className="supporting-text">Steps {terminal.stepCount}</span>
                    <span className="supporting-text">Tools {summarizeTools(terminal)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
