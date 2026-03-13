import fs from 'node:fs';
import path from 'node:path';

import type { AppConfig } from './config';
import { buildSessionDetail } from './domain/session-detail';
import type { ActionHistoryItem, SessionSummary, TerminalMessageItem } from './domain/events';
import type { ActionWriteInput } from './store/event-store';
import { buildActions, buildSessionRecord, parseJsonlRows, parseSessionsIndex } from './ingest/service';

export type AgentWorkspaceOption = {
  id: string;
  label: string;
  sessionsDir: string;
  sessionsIndexFile: string;
  sessionCount: number;
  isDefault: boolean;
};

function getAgentsRoot(config: AppConfig) {
  return path.resolve(config.sessionsDir, '..', '..');
}

export function getDefaultWorkspaceId(config: AppConfig) {
  return path.basename(path.resolve(config.sessionsDir, '..'));
}

function mapActionWriteInput(action: ActionWriteInput): ActionHistoryItem {
  return {
    eventId: action.id,
    sessionId: action.sessionId,
    sequence: action.sequence,
    kind: action.kind,
    status: action.status,
    title: action.title,
    summary: action.summary,
    startedAt: action.startedAt,
    endedAt: action.endedAt,
    cursor: action.cursor,
    payload: action.payload,
  };
}

function toWorkspaceConfig(config: AppConfig, workspaceId: string): AppConfig {
  const agentsRoot = getAgentsRoot(config);
  const sessionsDir = path.join(agentsRoot, workspaceId, 'sessions');

  return {
    ...config,
    sessionsDir,
    sessionsIndexFile: path.join(sessionsDir, 'sessions.json'),
  };
}

export function listAgentWorkspaces(config: AppConfig): AgentWorkspaceOption[] {
  const agentsRoot = getAgentsRoot(config);
  const defaultWorkspaceId = getDefaultWorkspaceId(config);

  let entries: string[] = [];

  try {
    entries = fs.readdirSync(agentsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => {
        if (left === defaultWorkspaceId) {
          return -1;
        }

        if (right === defaultWorkspaceId) {
          return 1;
        }

        return left.localeCompare(right);
      });
  } catch (_error) {
    entries = [defaultWorkspaceId];
  }

  return entries
    .map((workspaceId) => {
      const workspaceConfig = toWorkspaceConfig(config, workspaceId);
      const sessionsIndexFile = workspaceConfig.sessionsIndexFile;
      const sessionsDir = workspaceConfig.sessionsDir;

      if (!fs.existsSync(sessionsIndexFile)) {
        return null;
      }

      let sessionCount = 0;

      try {
        const parsed = JSON.parse(fs.readFileSync(sessionsIndexFile, 'utf8')) as Record<string, unknown>;
        sessionCount = Object.keys(parsed ?? {}).length;
      } catch (_error) {
        sessionCount = 0;
      }

      return {
        id: workspaceId,
        label: workspaceId,
        sessionsDir,
        sessionsIndexFile,
        sessionCount,
        isDefault: workspaceId === defaultWorkspaceId,
      } satisfies AgentWorkspaceOption;
    })
    .filter((item): item is AgentWorkspaceOption => item !== null);
}

export function resolveWorkspaceConfig(config: AppConfig, workspaceId?: string) {
  const options = listAgentWorkspaces(config);
  const fallbackWorkspaceId = getDefaultWorkspaceId(config);
  const targetWorkspaceId = workspaceId ?? fallbackWorkspaceId;
  const match = options.find((option) => option.id === targetWorkspaceId);

  if (!match) {
    throw new Error(
      `Unknown workspace \"${targetWorkspaceId}\". Available: ${options.map((item) => item.id).join(', ')}`
    );
  }

  return {
    workspace: match,
    config: toWorkspaceConfig(config, match.id),
  };
}

export function listSessionsForWorkspace(
  config: AppConfig,
  workspaceId: string,
  limit: number
): SessionSummary[] {
  const workspaceConfig = resolveWorkspaceConfig(config, workspaceId).config;
  const indexEntries = parseSessionsIndex(workspaceConfig);

  return indexEntries.slice(0, limit).map((entry) => {
    const rows = parseJsonlRows(entry.sessionFilePath);
    const actions = buildActions(entry.sessionId, rows);
    return buildSessionRecord(entry, rows, actions, workspaceConfig);
  });
}

export function getSessionBundleForWorkspace(config: AppConfig, workspaceId: string, sessionId: string) {
  const workspaceConfig = resolveWorkspaceConfig(config, workspaceId).config;
  const entry = parseSessionsIndex(workspaceConfig).find((item) => item.sessionId === sessionId) ?? null;

  if (!entry) {
    return {
      session: null,
      actions: [] as ActionHistoryItem[],
      terminalMessages: [] as TerminalMessageItem[],
    };
  }

  const rows = parseJsonlRows(entry.sessionFilePath);
  const actionWrites = buildActions(entry.sessionId, rows);
  const actions = actionWrites.map(mapActionWriteInput);
  const session = buildSessionRecord(entry, rows, actionWrites, workspaceConfig);
  const detail = buildSessionDetail(session, actions);

  return {
    session: detail.session,
    actions,
    terminalMessages: detail.terminalMessages,
  };
}

export function listWorkspaceSessionIds(config: AppConfig, workspaceId: string) {
  const workspaceConfig = resolveWorkspaceConfig(config, workspaceId).config;
  return parseSessionsIndex(workspaceConfig).map((entry) => entry.sessionId);
}
