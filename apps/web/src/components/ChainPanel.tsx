import type { ChainSummary, SessionSummary, TerminalMessageItem } from '../lib/api';

type ChainPanelProps = {
  session: SessionSummary | null;
  terminal: TerminalMessageItem | null;
};

function formatTime(value: number | null) {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleTimeString();
}

function buildSummaryPills(summary: ChainSummary) {
  return [
    { label: 'user', value: summary.user },
    { label: 'think', value: summary.think },
    { label: 'toolCall', value: summary.toolCall },
    { label: 'toolResult', value: summary.toolResult },
    { label: 'reply', value: summary.reply },
    { label: 'error', value: summary.assistantError },
  ].filter((item) => item.value > 0 || item.label === 'reply' || item.label === 'user');
}

export function ChainPanel(props: ChainPanelProps) {
  const terminal = props.terminal;

  return (
    <div className="panel-content">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Step 3</p>
          <h2>Agentic chain</h2>
        </div>
        <span className={`status-pill ${terminal?.pending ? 'status-stalled' : 'status-open'}`}>
          {terminal ? `${terminal.steps.length} steps` : 'waiting'}
        </span>
      </div>

      {terminal ? (
        <>
          <div className="supporting-block supporting-block-start">
            <strong className="card-title">
              {terminal.pending ? 'Pending reply window' : `Reply window #${terminal.ordinal}`}
            </strong>
            <span className="supporting-text">
              Session {props.session?.title ?? props.session?.id ?? 'unknown'}
            </span>
            <span className="supporting-text">
              Sequence span {terminal.startSequence}-{terminal.endSequence} · captured{' '}
              {formatTime(terminal.timestamp)}
            </span>
          </div>

          <div className="chain-summary">
            <p className="chain-context">
              {terminal.pending
                ? 'This window ends at the current user turn and has not produced a final assistant reply yet.'
                : 'This window contains the normalized user, thinking, tool, and reply steps that produced the selected terminal message.'}
            </p>

            <div className="reply-preview">
              {terminal.pending ? `Awaiting reply: ${terminal.fullText}` : terminal.fullText}
            </div>

            {terminal.triggerUserText ? (
              <p className="chain-context">Trigger message: {terminal.triggerUserText}</p>
            ) : null}

            <div className="summary-row">
              {buildSummaryPills(terminal.summary).map((item) => (
                <span key={item.label} className="summary-pill">
                  {item.label} {item.value}
                </span>
              ))}
            </div>

            <div className="summary-row">
              {terminal.summary.tools.length > 0 ? (
                terminal.summary.tools.map((tool) => (
                  <span key={tool} className="summary-pill summary-pill-accent">
                    tool: {tool}
                  </span>
                ))
              ) : (
                <span className="summary-pill">No tool calls</span>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <p>Select a terminal message to inspect its agentic chain.</p>
          <p className="supporting-text">
            The main workflow follows the v1 reading order from sessions to terminal windows to
            chain steps.
          </p>
        </div>
      )}

      <div className="panel-viewport chain-viewport">
        {terminal ? (
          terminal.steps.length > 0 ? (
            <ol className="chain-list">
              {terminal.steps.map((step) => (
                <li
                  key={step.eventId}
                  className={`timeline-card ${step.isError ? 'timeline-card-error' : ''}`}
                  data-kind={step.kind}
                >
                  <div className="timeline-head">
                    <div className="timeline-title-wrap">
                      <span className="timeline-label">{step.label}</span>
                      <strong className="card-title">{step.title}</strong>
                    </div>
                    <span className="supporting-text">{formatTime(step.timestamp)}</span>
                  </div>
                  <pre className="timeline-body">{step.body}</pre>
                  <p className="step-meta">{step.meta}</p>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty-state">
              <p>No chain steps were derived for this terminal window.</p>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
