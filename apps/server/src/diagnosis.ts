import fs from 'node:fs';

import { loadConfig, type AppConfig } from './config';
import { createDatabase } from './db/sqlite';
import type { ChainStep, SessionStatus, SessionSummary } from './domain/events';
import { createEventStore } from './store/event-store';
import { getSessionBundleForWorkspace, getDefaultWorkspaceId, listAgentWorkspaces, listSessionsForWorkspace } from './workspaces';

type JsonRecord = Record<string, unknown>;

export type DiagnosisSeverity = 'error' | 'warn' | 'info';
export type DiagnosisStatus = 'ok' | 'degraded' | 'failed';

export type DiagnosisServiceSnapshot = {
  mode: string;
  state: string;
  detail: string | null;
  logTarget: string | null;
};

export type DiagnosisIssue = {
  severity: DiagnosisSeverity;
  code: string;
  summary: string;
  details: string | null;
  workspaceId: string | null;
  sessionId: string | null;
};

export type ConcernSession = {
  workspaceId: string;
  sessionId: string;
  title: string | null;
  status: SessionStatus;
  updatedAt: number;
  ageMs: number;
  provider: string | null;
  chatType: string | null;
  deliveryTarget: string | null;
  actionCount: number | null;
  lastActionKind: string | null;
  lastActionAt: number | null;
  lastActionSummary: string | null;
  pendingTerminalMessage: boolean;
  lastStepKind: string | null;
  lastStepTitle: string | null;
  lastStepPreview: string | null;
  terminalPreview: string | null;
  diagnosis: string;
};

export type DiagnosisHealthSnapshot = {
  status: 'ok' | 'degraded' | 'unreachable';
  source: 'api' | 'local';
  apiReachable: boolean;
  now: number;
  ingest: {
    initialLoadCompleted: boolean;
    lastSessionSyncAt: number | null;
    lastRawSyncAt: number | null;
    sessionSyncError: string | null;
    rawSyncError: string | null;
    sessionsIndexFile: string;
    rawStreamFile: string;
  } | null;
  metrics: {
    sessionCount: number;
    actionEventCount: number;
    rawStreamCount: number;
    latestStreamCursor: number;
  } | null;
};

export type DiagnosisAiSnapshot = {
  attempted: boolean;
  model: string | null;
  summary: string | null;
  error: string | null;
};

export type DiagnosisReport = {
  generatedAt: number;
  overallStatus: DiagnosisStatus;
  defaultWorkspaceId: string;
  requestedWorkspaceId: string | null;
  service: DiagnosisServiceSnapshot;
  health: DiagnosisHealthSnapshot;
  sources: {
    databaseFile: string;
    rawStreamFile: string;
    sessionsDir: string;
    sessionsIndexFile: string;
  };
  metrics: {
    workspaceCount: number;
    totalSessions: number;
    byStatus: Record<SessionStatus, number>;
    rawStreamFileExists: boolean;
    rawStreamFileSizeBytes: number | null;
    rawStreamFileUpdatedAt: number | null;
    rawStreamFileAgeMs: number | null;
  };
  issues: DiagnosisIssue[];
  concernSessions: ConcernSession[];
  ai: DiagnosisAiSnapshot;
};

export type DiagnosisOptions = {
  config?: AppConfig;
  workspaceId?: string;
  includeAi?: boolean;
  healthTimeoutMs?: number;
};

type WorkspaceSessionSummary = {
  workspaceId: string;
  session: SessionSummary;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function previewText(value: string | null, maxLength = 120) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

function readServiceSnapshot(env: NodeJS.ProcessEnv): DiagnosisServiceSnapshot {
  return {
    mode: asString(env.CLAW_TRACE_DIAGNOSIS_SERVICE_MODE) ?? 'unknown',
    state: asString(env.CLAW_TRACE_DIAGNOSIS_SERVICE_STATE) ?? 'unknown',
    detail: asString(env.CLAW_TRACE_DIAGNOSIS_SERVICE_DETAIL),
    logTarget: asString(env.CLAW_TRACE_DIAGNOSIS_LOG_TARGET),
  };
}

function emptyStatusCounts(): Record<SessionStatus, number> {
  return {
    running: 0,
    stalled: 0,
    failed: 0,
    completed: 0,
    idle: 0,
    unknown: 0,
  };
}

function readRawStreamStats(rawStreamFile: string, now: number) {
  try {
    const stat = fs.statSync(rawStreamFile);
    return {
      exists: true,
      sizeBytes: stat.size,
      updatedAt: Math.trunc(stat.mtimeMs),
      ageMs: Math.max(0, now - Math.trunc(stat.mtimeMs)),
    };
  } catch {
    return {
      exists: false,
      sizeBytes: null,
      updatedAt: null,
      ageMs: null,
    };
  }
}

async function fetchHealthSnapshot(
  config: AppConfig,
  timeoutMs: number
): Promise<DiagnosisHealthSnapshot | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/v2/health`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as JsonRecord;
    const ingest = isRecord(payload.ingest) ? payload.ingest : null;
    const metrics = isRecord(payload.metrics) ? payload.metrics : null;
    const status = payload.status === 'degraded' ? 'degraded' : 'ok';

    return {
      status,
      source: 'api',
      apiReachable: true,
      now: asNumber(payload.now) ?? Date.now(),
      ingest: ingest
        ? {
            initialLoadCompleted: ingest.initialLoadCompleted === true,
            lastSessionSyncAt: asNumber(ingest.lastSessionSyncAt),
            lastRawSyncAt: asNumber(ingest.lastRawSyncAt),
            sessionSyncError: asString(ingest.sessionSyncError),
            rawSyncError: asString(ingest.rawSyncError),
            sessionsIndexFile: asString(ingest.sessionsIndexFile) ?? config.sessionsIndexFile,
            rawStreamFile: asString(ingest.rawStreamFile) ?? config.rawStreamFile,
          }
        : null,
      metrics: metrics
        ? {
            sessionCount: asNumber(metrics.sessionCount) ?? 0,
            actionEventCount: asNumber(metrics.actionEventCount) ?? 0,
            rawStreamCount: asNumber(metrics.rawStreamCount) ?? 0,
            latestStreamCursor: asNumber(metrics.latestStreamCursor) ?? 0,
          }
        : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readLocalHealthSnapshot(config: AppConfig): DiagnosisHealthSnapshot {
  let metrics: DiagnosisHealthSnapshot['metrics'] = null;

  if (fs.existsSync(config.databaseFile)) {
    try {
      const db = createDatabase(config);
      const store = createEventStore(db);
      metrics = store.getMetrics();
      db.close();
    } catch {
      metrics = null;
    }
  }

  return {
    status: 'unreachable',
    source: 'local',
    apiReachable: false,
    now: Date.now(),
    ingest: null,
    metrics,
  };
}

function formatStage(stepKind: string | null, title: string | null) {
  switch (stepKind) {
    case 'toolCall':
      return title ? `工具调用 ${title}` : '工具调用';
    case 'toolResult':
      return title ? `工具返回 ${title}` : '工具返回';
    case 'think':
      return '模型推理';
    case 'assistantError':
      return title ? `错误 ${title}` : '错误';
    case 'assistantText':
      return '助手文本输出';
    case 'reply':
      return '最终回复';
    case 'user':
      return '用户消息';
    case 'system':
      return title ? `系统步骤 ${title}` : '系统步骤';
    default:
      return title ?? '未知阶段';
  }
}

function describeAge(ageMs: number) {
  if (ageMs < 1_000) {
    return '刚刚';
  }

  const seconds = Math.floor(ageMs / 1_000);

  if (seconds < 60) {
    return `${seconds} 秒前`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} 小时前`;
  }

  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function buildConcernSession(
  workspaceId: string,
  session: SessionSummary,
  config: AppConfig,
  now: number
): ConcernSession {
  const bundle = getSessionBundleForWorkspace(config, workspaceId, session.id);
  const metadata = isRecord(session.metadata) ? session.metadata : null;
  const lastMessage = bundle.terminalMessages[bundle.terminalMessages.length - 1] ?? null;
  const lastStep = lastMessage?.steps[lastMessage.steps.length - 1] ?? null;
  const lastErrorStep =
    lastMessage?.steps
      .slice()
      .reverse()
      .find((step) => step.isError) ?? null;
  const lastActionAt =
    asNumber(metadata?.lastActionAt) ??
    session.updatedAt;
  const ageMs = Math.max(0, now - lastActionAt);
  const lastStage = lastErrorStep ?? lastStep;
  const lastStepKind = lastStage?.kind ?? asString(metadata?.lastActionKind);
  const lastStepTitle = lastStage?.title ?? null;
  const lastStepPreview = previewText(lastStage?.body ?? null);
  const terminalPreview = previewText(lastMessage?.preview ?? lastMessage?.fullText ?? null);
  let diagnosis = '';

  if (session.status === 'failed') {
    diagnosis = `最后失败在 ${formatStage(lastStepKind, lastStepTitle)}，最近更新 ${describeAge(ageMs)}`;
  } else if (session.status === 'stalled') {
    diagnosis = `当前卡在 ${formatStage(lastStepKind, lastStepTitle)}，已经停滞 ${describeAge(ageMs)}`;
  } else if (session.status === 'running') {
    diagnosis = `当前运行到 ${formatStage(lastStepKind, lastStepTitle)}，最近更新 ${describeAge(ageMs)}`;
  } else if (session.status === 'idle') {
    diagnosis = `当前空闲，最后停在 ${formatStage(lastStepKind, lastStepTitle)}，最近更新 ${describeAge(ageMs)}`;
  } else {
    diagnosis = `当前状态 ${session.status}，最后停在 ${formatStage(lastStepKind, lastStepTitle)}，最近更新 ${describeAge(ageMs)}`;
  }

  return {
    workspaceId,
    sessionId: session.id,
    title: session.title,
    status: session.status,
    updatedAt: session.updatedAt,
    ageMs,
    provider: asString(metadata?.provider),
    chatType: asString(metadata?.chatType),
    deliveryTarget: asString(metadata?.deliveryTarget),
    actionCount: asNumber(metadata?.actionCount),
    lastActionKind: asString(metadata?.lastActionKind),
    lastActionAt,
    lastActionSummary: session.lastActionSummary,
    pendingTerminalMessage: lastMessage?.pending === true,
    lastStepKind,
    lastStepTitle,
    lastStepPreview,
    terminalPreview,
    diagnosis,
  };
}

function pushIssue(
  issues: DiagnosisIssue[],
  severity: DiagnosisSeverity,
  code: string,
  summary: string,
  details: string | null = null,
  workspaceId: string | null = null,
  sessionId: string | null = null
) {
  issues.push({
    severity,
    code,
    summary,
    details,
    workspaceId,
    sessionId,
  });
}

function summarizeConcernIssues(
  concerns: ConcernSession[],
  config: AppConfig,
  issues: DiagnosisIssue[]
) {
  for (const concern of concerns) {
    if (concern.status === 'failed') {
      pushIssue(
        issues,
        'error',
        'session_failed',
        `Session ${concern.sessionId} 已失败`,
        concern.diagnosis,
        concern.workspaceId,
        concern.sessionId
      );
      continue;
    }

    if (concern.status === 'stalled') {
      pushIssue(
        issues,
        'warn',
        'session_stalled',
        `Session ${concern.sessionId} 已停滞`,
        concern.diagnosis,
        concern.workspaceId,
        concern.sessionId
      );
      continue;
    }

    if (concern.status === 'running' && concern.ageMs > Math.floor(config.sessionStallMs / 2)) {
      pushIssue(
        issues,
        'info',
        'session_running_long',
        `Session ${concern.sessionId} 运行时间偏长`,
        concern.diagnosis,
        concern.workspaceId,
        concern.sessionId
      );
    }
  }
}

function determineOverallStatus(
  issues: DiagnosisIssue[],
  service: DiagnosisServiceSnapshot,
  health: DiagnosisHealthSnapshot
): DiagnosisStatus {
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warnCount = issues.filter((issue) => issue.severity === 'warn').length;
  const serviceInactive =
    service.state === 'stopped' ||
    service.state === 'inactive' ||
    service.state === 'failed' ||
    service.state === 'dead';

  if (serviceInactive || health.status === 'degraded' || errorCount > 0) {
    return serviceInactive ? 'failed' : 'degraded';
  }

  if (warnCount > 0 || !health.apiReachable) {
    return 'degraded';
  }

  return 'ok';
}

function createAiInput(report: DiagnosisReport) {
  return {
    overallStatus: report.overallStatus,
    service: report.service,
    health: {
      status: report.health.status,
      source: report.health.source,
      apiReachable: report.health.apiReachable,
      ingest: report.health.ingest,
      metrics: report.health.metrics,
    },
    metrics: report.metrics,
    issues: report.issues.slice(0, 20),
    concernSessions: report.concernSessions.slice(0, 20).map((session) => ({
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      status: session.status,
      ageMs: session.ageMs,
      title: session.title,
      lastActionSummary: session.lastActionSummary,
      lastStepKind: session.lastStepKind,
      lastStepTitle: session.lastStepTitle,
      lastStepPreview: session.lastStepPreview,
      terminalPreview: session.terminalPreview,
      diagnosis: session.diagnosis,
    })),
  };
}

async function summarizeWithAi(report: DiagnosisReport): Promise<DiagnosisAiSnapshot> {
  const model =
    process.env.CLAW_TRACE_DIAGNOSIS_MODEL ??
    process.env.OPENAI_MODEL ??
    null;

  if (!model) {
    return {
      attempted: false,
      model: null,
      summary: null,
      error: null,
    };
  }

  const apiKey =
    process.env.CLAW_TRACE_DIAGNOSIS_API_KEY ??
    process.env.OPENAI_API_KEY ??
    null;
  const baseUrl = (
    process.env.CLAW_TRACE_DIAGNOSIS_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    'https://api.openai.com/v1'
  ).replace(/\/$/, '');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              '你是 OpenClaw 运行诊断助手。请基于给定的结构化诊断数据，用简洁中文总结当前整体运行状况、主要卡点、最需要优先处理的问题。不要编造缺失信息。',
          },
          {
            role: 'user',
            content: JSON.stringify(createAiInput(report), null, 2),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        attempted: true,
        model,
        summary: null,
        error: `AI 请求失败: ${response.status} ${errorText}`.trim(),
      };
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
        };
      }>;
    };
    const summary = payload.choices?.[0]?.message?.content?.trim() ?? null;

    return {
      attempted: true,
      model,
      summary,
      error: summary ? null : 'AI 返回内容为空',
    };
  } catch (error) {
    return {
      attempted: true,
      model,
      summary: null,
      error: error instanceof Error ? error.message : 'Unknown AI error',
    };
  }
}

export async function collectDiagnosisReport(
  options: DiagnosisOptions = {}
): Promise<DiagnosisReport> {
  const config = options.config ?? loadConfig();
  const now = Date.now();
  const service = readServiceSnapshot(process.env);
  const defaultWorkspaceId = getDefaultWorkspaceId(config);
  const requestedWorkspaceId = options.workspaceId ?? null;
  const health =
    (await fetchHealthSnapshot(config, options.healthTimeoutMs ?? 1_500)) ??
    readLocalHealthSnapshot(config);
  const rawStreamStats = readRawStreamStats(config.rawStreamFile, now);
  const issues: DiagnosisIssue[] = [];
  const byStatus = emptyStatusCounts();
  const summaries: WorkspaceSessionSummary[] = [];

  if (
    service.state === 'stopped' ||
    service.state === 'inactive' ||
    service.state === 'failed' ||
    service.state === 'dead'
  ) {
    pushIssue(issues, 'error', 'service_inactive', 'claw-trace 服务当前未运行', service.detail);
  }

  if (!health.apiReachable) {
    pushIssue(
      issues,
      service.state === 'running' || service.state === 'active' ? 'warn' : 'info',
      'api_unreachable',
      '本机诊断 API 当前不可达，已回退到本地文件/SQLite 诊断',
      `http://127.0.0.1:${config.port}/api/v2/health`
    );
  }

  if (health.ingest?.sessionSyncError) {
    pushIssue(
      issues,
      'error',
      'session_sync_error',
      'session 同步存在错误',
      health.ingest.sessionSyncError
    );
  }

  if (health.ingest?.rawSyncError) {
    pushIssue(
      issues,
      'error',
      'raw_sync_error',
      'raw stream 同步存在错误',
      health.ingest.rawSyncError
    );
  }

  if (!rawStreamStats.exists) {
    pushIssue(
      issues,
      'warn',
      'raw_stream_missing',
      'raw stream 文件不存在',
      config.rawStreamFile
    );
  }

  const workspaceOptions = listAgentWorkspaces(config);
  const selectedWorkspaces = requestedWorkspaceId
    ? workspaceOptions.filter((workspace) => workspace.id === requestedWorkspaceId)
    : workspaceOptions;

  if (requestedWorkspaceId && selectedWorkspaces.length === 0) {
    throw new Error(`Unknown workspace "${requestedWorkspaceId}"`);
  }

  if (selectedWorkspaces.length === 0) {
    pushIssue(
      issues,
      'warn',
      'no_workspace',
      '未发现可读取的 workspace sessions 索引',
      config.sessionsIndexFile
    );
  }

  for (const workspace of selectedWorkspaces) {
    try {
      const items = listSessionsForWorkspace(
        config,
        workspace.id,
        Math.max(workspace.sessionCount, 1_000)
      );

      for (const session of items) {
        byStatus[session.status] += 1;
        summaries.push({
          workspaceId: workspace.id,
          session,
        });
      }
    } catch (error) {
      pushIssue(
        issues,
        'error',
        'workspace_read_failed',
        `无法读取 workspace ${workspace.id} 的 sessions`,
        error instanceof Error ? error.message : 'Unknown workspace read error',
        workspace.id
      );
    }
  }

  summaries.sort((left, right) => right.session.updatedAt - left.session.updatedAt);

  const concernCandidates = summaries.filter(({ session }) =>
    ['running', 'stalled', 'failed', 'unknown'].includes(session.status)
  );
  const concernSessions = concernCandidates.map(({ workspaceId, session }) =>
    buildConcernSession(workspaceId, session, config, now)
  );

  summarizeConcernIssues(concernSessions, config, issues);

  if (
    rawStreamStats.exists &&
    rawStreamStats.ageMs != null &&
    rawStreamStats.ageMs > config.sessionStallMs &&
    concernSessions.some((session) => session.status === 'running' || session.status === 'stalled')
  ) {
    pushIssue(
      issues,
      'warn',
      'raw_stream_stale',
      'raw stream 长时间未更新，可能影响实时诊断',
      `最后更新 ${describeAge(rawStreamStats.ageMs)}`
    );
  }

  const totalSessions = summaries.length;
  const overallStatus = determineOverallStatus(issues, service, health);
  const report: DiagnosisReport = {
    generatedAt: now,
    overallStatus,
    defaultWorkspaceId,
    requestedWorkspaceId,
    service,
    health,
    sources: {
      databaseFile: config.databaseFile,
      rawStreamFile: config.rawStreamFile,
      sessionsDir: config.sessionsDir,
      sessionsIndexFile: config.sessionsIndexFile,
    },
    metrics: {
      workspaceCount: selectedWorkspaces.length,
      totalSessions,
      byStatus,
      rawStreamFileExists: rawStreamStats.exists,
      rawStreamFileSizeBytes: rawStreamStats.sizeBytes,
      rawStreamFileUpdatedAt: rawStreamStats.updatedAt,
      rawStreamFileAgeMs: rawStreamStats.ageMs,
    },
    issues,
    concernSessions,
    ai: {
      attempted: false,
      model: null,
      summary: null,
      error: null,
    },
  };

  if (options.includeAi !== false) {
    report.ai = await summarizeWithAi(report);
  }

  return report;
}
