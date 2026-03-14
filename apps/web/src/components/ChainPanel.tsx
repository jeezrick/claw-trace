import { useEffect, useMemo, useState } from 'react';

import type { ChainSummary, ChainStep, SessionSummary, TerminalMessageItem } from '../lib/api';

type ChainPanelProps = {
  session: SessionSummary | null;
  terminal: TerminalMessageItem | null;
};

type SourceModalState = {
  title: string;
  content: string;
};

const COLLAPSE_CHAR_LIMIT = 360;
const COLLAPSE_LINE_LIMIT = 10;

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

function shouldCollapseBody(text: string) {
  return text.length > COLLAPSE_CHAR_LIMIT || text.split('\n').length > COLLAPSE_LINE_LIMIT;
}

function buildCollapsedBody(text: string) {
  const lines = text.split('\n');
  const clippedByLines = lines.length > COLLAPSE_LINE_LIMIT;
  const clippedLines = clippedByLines ? lines.slice(0, COLLAPSE_LINE_LIMIT) : lines;
  let preview = clippedLines.join('\n');

  if (preview.length > COLLAPSE_CHAR_LIMIT) {
    preview = `${preview.slice(0, COLLAPSE_CHAR_LIMIT).trimEnd()}…`;
  } else if (clippedByLines) {
    preview = `${preview.trimEnd()}\n…`;
  }

  return preview;
}

function formatSource(raw: unknown, fallback: string) {
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }

  if (raw == null) {
    return fallback;
  }

  try {
    return JSON.stringify(raw, null, 2);
  } catch (_error) {
    return String(raw);
  }
}

function isStepExpanded(step: ChainStep, expandedStepIds: string[]) {
  return expandedStepIds.includes(step.eventId);
}

export function ChainPanel(props: ChainPanelProps) {
  const terminal = props.terminal;
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [sourceModal, setSourceModal] = useState<SourceModalState | null>(null);

  useEffect(() => {
    setExpandedStepIds([]);
    setSourceModal(null);
  }, [terminal?.key]);

  useEffect(() => {
    if (!sourceModal) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSourceModal(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sourceModal]);

  const collapsibleStepIds = useMemo(() => {
    if (!terminal) {
      return [] as string[];
    }

    return terminal.steps
      .filter((step) => shouldCollapseBody(step.body))
      .map((step) => step.eventId);
  }, [terminal]);

  const allExpandableStepsExpanded =
    collapsibleStepIds.length > 0 &&
    collapsibleStepIds.every((eventId) => expandedStepIds.includes(eventId));

  function toggleStepExpansion(step: ChainStep) {
    if (!shouldCollapseBody(step.body)) {
      return;
    }

    setExpandedStepIds((currentStepIds) => {
      if (currentStepIds.includes(step.eventId)) {
        return currentStepIds.filter((eventId) => eventId !== step.eventId);
      }

      return [...currentStepIds, step.eventId];
    });
  }

  function setAllStepsExpanded(nextExpanded: boolean) {
    setExpandedStepIds(nextExpanded ? collapsibleStepIds : []);
  }

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

      {!terminal && (
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

              {collapsibleStepIds.length > 0 ? (
                <div className="summary-row summary-row-actions">
                  <span className="supporting-text">
                    {collapsibleStepIds.length} long {collapsibleStepIds.length === 1 ? 'step' : 'steps'}
                  </span>
                  <button
                    type="button"
                    className="source-button source-button-secondary"
                    onClick={() => setAllStepsExpanded(!allExpandableStepsExpanded)}
                  >
                    {allExpandableStepsExpanded ? '收起全部' : '展开全部'}
                  </button>
                </div>
              ) : null}
            </div>

            {terminal.steps.length > 0 ? (
              <ol className="chain-list">
                {terminal.steps.map((step) => {
                const collapsible = shouldCollapseBody(step.body);
                const expanded = isStepExpanded(step, expandedStepIds);
                const body = collapsible && !expanded ? buildCollapsedBody(step.body) : step.body;

                return (
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

                    <div className="timeline-content">
                      <pre className="timeline-body">{body}</pre>

                      <div className="timeline-actions">
                        {collapsible ? (
                          <button
                            type="button"
                            className="source-button source-button-secondary"
                            onClick={() => toggleStepExpansion(step)}
                          >
                            {expanded ? '收起' : '展开完整内容'}
                          </button>
                        ) : null}

                        <button
                          type="button"
                          className="source-button"
                          onClick={() =>
                            setSourceModal({
                              title: `${step.label} · ${step.title}`,
                              content: formatSource(step.raw, step.body),
                            })
                          }
                        >
                          查看源码
                        </button>
                      </div>

                      <p className="step-meta">{step.meta}</p>
                    </div>
                  </li>
                );
                })}
              </ol>
            ) : (
              <div className="empty-state">
                <p>No chain steps were derived for this terminal window.</p>
              </div>
            )}
          </>
        ) : null}
      </div>

      {sourceModal ? (
        <div
          className="source-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="source-modal-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSourceModal(null);
            }
          }}
        >
          <div className="source-modal-panel">
            <div className="source-modal-head">
              <h3 id="source-modal-title">{sourceModal.title}</h3>
              <button
                type="button"
                className="source-button source-button-secondary source-close"
                onClick={() => setSourceModal(null)}
              >
                关闭
              </button>
            </div>
            <pre className="source-code">{sourceModal.content}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
