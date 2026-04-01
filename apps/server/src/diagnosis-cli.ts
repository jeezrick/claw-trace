import { collectDiagnosisReport, type ConcernSession, type DiagnosisIssue, type DiagnosisReport } from './diagnosis';

type CliOptions = {
  json: boolean;
  includeAi: boolean;
  workspaceId?: string;
};

function formatTime(timestamp: number | null) {
  if (!timestamp) {
    return '-';
  }

  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(ageMs: number | null) {
  if (ageMs == null) {
    return '-';
  }

  if (ageMs < 1_000) {
    return '刚刚';
  }

  const seconds = Math.floor(ageMs / 1_000);

  if (seconds < 60) {
    return `${seconds} 秒`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} 分钟`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} 小时`;
  }

  const days = Math.floor(hours / 24);
  return `${days} 天`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    includeAi: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case '--json':
        options.json = true;
        break;
      case '--no-ai':
        options.includeAi = false;
        break;
      case '--workspace':
        i += 1;
        if (!argv[i]) {
          throw new Error('--workspace 需要传入 workspace id');
        }
        options.workspaceId = argv[i];
        break;
      case '--help':
      case '-h':
        console.log(`用法:
  claw-trace diagnosis [--json] [--no-ai] [--workspace <id>]`);
        process.exit(0);
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }

  return options;
}

function renderIssue(issue: DiagnosisIssue) {
  const target = issue.sessionId
    ? ` [workspace=${issue.workspaceId ?? '-'} session=${issue.sessionId}]`
    : issue.workspaceId
      ? ` [workspace=${issue.workspaceId}]`
      : '';

  const details = issue.details ? `: ${issue.details}` : '';
  return `- [${issue.severity}] ${issue.summary}${target}${details}`;
}

function renderConcern(session: ConcernSession) {
  const meta = [
    `workspace=${session.workspaceId}`,
    `status=${session.status}`,
    `最近活跃=${formatDuration(session.ageMs)}前`,
  ];

  if (session.lastStepKind) {
    meta.push(`阶段=${session.lastStepKind}`);
  }

  return [
    `- ${session.sessionId}${session.title ? ` (${session.title})` : ''}`,
    `  ${meta.join(' · ')}`,
    `  诊断: ${session.diagnosis}`,
    session.lastStepPreview ? `  最近步骤: ${session.lastStepPreview}` : null,
    session.terminalPreview ? `  最近终端消息: ${session.terminalPreview}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function renderStructuredReport(report: DiagnosisReport) {
  const lines: string[] = [];

  lines.push('claw-trace diagnosis');
  lines.push(`overall_status: ${report.overallStatus}`);
  lines.push(`generated_at: ${formatTime(report.generatedAt)}`);

  if (report.ai.summary) {
    lines.push('ai_diagnosis:');
    lines.push(report.ai.summary);
    lines.push('');
  } else if (report.ai.attempted && report.ai.error) {
    lines.push(`ai_diagnosis_error: ${report.ai.error}`);
    lines.push('');
  }

  lines.push(`service: mode=${report.service.mode} state=${report.service.state}`);

  if (report.service.detail) {
    lines.push(`service_detail: ${report.service.detail}`);
  }

  if (report.service.logTarget) {
    lines.push(`logs: ${report.service.logTarget}`);
  }

  lines.push(
    `health: status=${report.health.status} source=${report.health.source} api_reachable=${report.health.apiReachable ? 'yes' : 'no'}`
  );
  lines.push(
    `sessions: total=${report.metrics.totalSessions} running=${report.metrics.byStatus.running} stalled=${report.metrics.byStatus.stalled} failed=${report.metrics.byStatus.failed} completed=${report.metrics.byStatus.completed} idle=${report.metrics.byStatus.idle} unknown=${report.metrics.byStatus.unknown}`
  );
  lines.push(`workspaces: ${report.metrics.workspaceCount}`);
  lines.push(`database_file: ${report.sources.databaseFile}`);
  lines.push(`raw_stream_file: ${report.sources.rawStreamFile}`);

  if (report.metrics.rawStreamFileExists) {
    lines.push(
      `raw_stream: size=${report.metrics.rawStreamFileSizeBytes ?? 0}B updated_at=${formatTime(report.metrics.rawStreamFileUpdatedAt)} age=${formatDuration(report.metrics.rawStreamFileAgeMs)}`
    );
  } else {
    lines.push('raw_stream: missing');
  }

  lines.push('');
  lines.push('issues:');

  if (report.issues.length === 0) {
    lines.push('- 无明显问题');
  } else {
    for (const issue of report.issues) {
      lines.push(renderIssue(issue));
    }
  }

  lines.push('');
  lines.push('sessions_of_concern:');

  if (report.concernSessions.length === 0) {
    lines.push('- 当前没有 running/stalled/failed/unknown session');
  } else {
    for (const concern of report.concernSessions) {
      lines.push(renderConcern(concern));
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await collectDiagnosisReport({
    workspaceId: options.workspaceId,
    includeAi: options.includeAi,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(renderStructuredReport(report));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown diagnosis error';
  console.error(`claw-trace diagnosis failed: ${message}`);
  process.exit(1);
});
