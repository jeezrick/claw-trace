import type { ReactNode } from 'react';

type AppShellProps = {
  sessionPanel: ReactNode;
  actionPanel: ReactNode;
  debugPanel: ReactNode;
  selectedSessionId: string | null;
};

export function AppShell(props: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="shell-header">
        <div>
          <p className="eyebrow">OpenClaw internal console</p>
          <h1>claw-trace v2 phase 1</h1>
        </div>
        <div className="header-meta">
          <span className="meta-label">Selection</span>
          <code>{props.selectedSessionId ?? 'none'}</code>
        </div>
      </header>

      <main className="workspace-grid">
        <section className="panel panel-sessions">{props.sessionPanel}</section>
        <section className="panel panel-history">{props.actionPanel}</section>
        <section className="panel panel-debug">{props.debugPanel}</section>
      </main>
    </div>
  );
}
