import type {
  ActionHistoryItem,
  ChainStep,
  ChainSummary,
  SessionSummary,
  TerminalMessageItem,
} from './events';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getPayloadRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function getString(record: JsonRecord | null, key: string): string | null {
  if (!record) {
    return null;
  }

  const value = record[key];
  return typeof value === 'string' && value ? value : null;
}

function getNumber(record: JsonRecord | null, key: string): number | null {
  if (!record) {
    return null;
  }

  const value = record[key];

  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function stringifyValue(value: unknown): string {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toBodyText(action: ActionHistoryItem, payload: JsonRecord | null): string {
  const summary = action.summary ?? action.title;

  switch (action.kind) {
    case 'user':
      return getString(payload, 'text') ?? summary;
    case 'think':
      return getString(payload, 'thinking') ?? summary;
    case 'toolCall':
      return stringifyValue(payload?.arguments ?? action.payload);
    case 'toolResult':
      return (
        getString(payload, 'text') ??
        stringifyValue(payload?.details ?? action.payload) ??
        summary
      );
    case 'reply':
    case 'assistantText':
      return getString(payload, 'text') ?? summary;
    case 'assistantError':
      return getString(payload, 'errorMessage') ?? summary;
    default:
      return stringifyValue(action.payload) || summary;
  }
}

function toStepMeta(action: ActionHistoryItem, payload: JsonRecord | null): string {
  const parts: string[] = [`seq ${action.sequence}`];
  const rowIndex = getNumber(payload, 'rowIndex');
  const toolCallId = getString(payload, 'toolCallId');
  const stopReason = getString(payload, 'stopReason');

  if (rowIndex != null) {
    parts.push(`row ${rowIndex}`);
  }

  if (toolCallId) {
    parts.push(`callId=${toolCallId}`);
  }

  if (stopReason) {
    parts.push(`stopReason=${stopReason}`);
  }

  return parts.join(' · ');
}

function toStep(action: ActionHistoryItem): ChainStep {
  const payload = getPayloadRecord(action.payload);
  const timestamp = action.endedAt ?? action.startedAt;

  switch (action.kind) {
    case 'user':
      return {
        eventId: action.eventId,
        sequence: action.sequence,
        kind: action.kind,
        label: 'USER',
        title: 'User message',
        timestamp,
        body: toBodyText(action, payload) || '(empty user message)',
        meta: toStepMeta(action, payload),
        isError: false,
        raw: action.payload,
      };
    case 'think':
      return {
        eventId: action.eventId,
        sequence: action.sequence,
        kind: action.kind,
        label: 'THINK',
        title: 'Reasoning trace',
        timestamp,
        body: toBodyText(action, payload) || '(empty reasoning trace)',
        meta: toStepMeta(action, payload),
        isError: false,
        raw: action.payload,
      };
    case 'toolCall':
      return {
        eventId: action.eventId,
        sequence: action.sequence,
        kind: action.kind,
        label: 'TOOL CALL',
        title: action.title || 'unknown tool',
        timestamp,
        body: toBodyText(action, payload) || '{}',
        meta: toStepMeta(action, payload),
        isError: false,
        raw: action.payload,
      };
    case 'toolResult':
      return {
        eventId: action.eventId,
        sequence: action.sequence,
        kind: action.kind,
        label: 'RESULT',
        title: action.title || 'tool result',
        timestamp,
        body: toBodyText(action, payload) || '(empty tool result)',
        meta: toStepMeta(action, payload),
        isError: action.status === 'failed' || payload?.isError === true,
        raw: action.payload,
      };
    case 'reply':
      return {
        eventId: action.eventId,
        sequence: action.sequence,
        kind: action.kind,
        label: 'FINAL',
        title: 'Final reply',
        timestamp,
        body: toBodyText(action, payload) || '(empty assistant text)',
        meta: toStepMeta(action, payload),
        isError: false,
        raw: action.payload,
      };
    case 'assistantText':
      return {
        eventId: action.eventId,
        sequence: action.sequence,
        kind: action.kind,
        label: 'ASSISTANT',
        title: 'Assistant text',
        timestamp,
        body: toBodyText(action, payload) || '(empty assistant text)',
        meta: toStepMeta(action, payload),
        isError: false,
        raw: action.payload,
      };
    case 'assistantError':
      return {
        eventId: action.eventId,
        sequence: action.sequence,
        kind: action.kind,
        label: 'ERROR',
        title: action.title || 'Assistant error',
        timestamp,
        body: toBodyText(action, payload) || 'Assistant run failed.',
        meta: toStepMeta(action, payload),
        isError: true,
        raw: action.payload,
      };
    default:
      return {
        eventId: action.eventId,
        sequence: action.sequence,
        kind: action.kind,
        label: 'SYSTEM',
        title: action.title,
        timestamp,
        body: toBodyText(action, payload),
        meta: toStepMeta(action, payload),
        isError: false,
        raw: action.payload,
      };
  }
}

function summarizeSteps(steps: ChainStep[]): ChainSummary {
  const summary: ChainSummary = {
    user: 0,
    think: 0,
    toolCall: 0,
    toolResult: 0,
    reply: 0,
    assistantError: 0,
    assistantText: 0,
    system: 0,
    tools: [],
  };

  const tools = new Set<string>();

  for (const step of steps) {
    summary[step.kind] += 1;

    if (step.kind === 'toolCall' && step.title) {
      tools.add(step.title);
    }
  }

  summary.tools = Array.from(tools);
  return summary;
}

function previewText(value: string | null, maxLength = 140): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return '(empty text)';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

function toTerminalMessage(
  terminalAction: ActionHistoryItem,
  ordinal: number,
  startSequence: number,
  endSequence: number,
  actions: ActionHistoryItem[]
): TerminalMessageItem {
  const payload = getPayloadRecord(terminalAction.payload);
  const steps = actions.map(toStep);
  const triggerUser =
    [...actions].reverse().find((action) => action.kind === 'user') ?? null;
  const triggerPayload = getPayloadRecord(triggerUser?.payload ?? null);
  const fullText =
    getString(payload, 'text') ?? terminalAction.summary ?? terminalAction.title ?? '(empty text)';

  return {
    key: `reply:${terminalAction.eventId}`,
    eventId: terminalAction.eventId,
    ordinal,
    timestamp: terminalAction.endedAt ?? terminalAction.startedAt,
    rowIndex: getNumber(payload, 'rowIndex'),
    preview: previewText(fullText),
    fullText,
    pending: false,
    startSequence,
    endSequence,
    stepCount: steps.length,
    triggerUserText: getString(triggerPayload, 'text') ?? triggerUser?.summary ?? null,
    summary: summarizeSteps(steps),
    steps,
  };
}

function toPendingTerminalMessage(
  userAction: ActionHistoryItem,
  ordinal: number,
  startSequence: number,
  endSequence: number,
  actions: ActionHistoryItem[]
): TerminalMessageItem {
  const payload = getPayloadRecord(userAction.payload);
  const steps = actions.map(toStep);
  const fullText =
    getString(payload, 'text') ?? userAction.summary ?? userAction.title ?? '(empty text)';

  return {
    key: `pending:${userAction.eventId}`,
    eventId: userAction.eventId,
    ordinal,
    timestamp: userAction.endedAt ?? userAction.startedAt,
    rowIndex: getNumber(payload, 'rowIndex'),
    preview: previewText(fullText),
    fullText,
    pending: true,
    startSequence,
    endSequence,
    stepCount: steps.length,
    triggerUserText: fullText,
    summary: summarizeSteps(steps),
    steps,
  };
}

export function buildTerminalMessages(actions: ActionHistoryItem[]): TerminalMessageItem[] {
  if (actions.length === 0) {
    return [];
  }

  const terminalMessages: TerminalMessageItem[] = [];
  const replyActions = actions.filter((action) => action.kind === 'reply');
  let previousReplySequence = 0;

  replyActions.forEach((replyAction, index) => {
    const startSequence = previousReplySequence + 1;
    const endSequence = replyAction.sequence;
    const scopedActions = actions.filter(
      (action) => action.sequence >= startSequence && action.sequence <= endSequence
    );

    terminalMessages.push(
      toTerminalMessage(replyAction, index + 1, startSequence, endSequence, scopedActions)
    );
    previousReplySequence = replyAction.sequence;
  });

  const tailUserAction =
    [...actions]
      .reverse()
      .find((action) => action.kind === 'user' && action.sequence > previousReplySequence) ?? null;

  if (tailUserAction) {
    const startSequence = previousReplySequence + 1;
    const endSequence = actions[actions.length - 1]?.sequence ?? tailUserAction.sequence;
    const scopedActions = actions.filter(
      (action) => action.sequence >= startSequence && action.sequence <= endSequence
    );

    terminalMessages.push(
      toPendingTerminalMessage(
        tailUserAction,
        terminalMessages.length + 1,
        startSequence,
        endSequence,
        scopedActions
      )
    );
  }

  return terminalMessages;
}

export function buildSessionDetail(
  session: SessionSummary | null,
  actions: ActionHistoryItem[]
): {
  session: SessionSummary | null;
  terminalMessages: TerminalMessageItem[];
} {
  return {
    session,
    terminalMessages: buildTerminalMessages(actions),
  };
}
