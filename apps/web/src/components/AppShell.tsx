import type { ReactNode } from 'react';

import type { WorkspaceTab } from '../store/app-store';

type AppShellProps = {
  sessionPanel: ReactNode;
  mainPanel: ReactNode;
  actionPanel: ReactNode;
  debugPanel: ReactNode;
  selectedSessionId: string | null;
  selectedTerminalLabel: string | null;
  workspaceTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
};

const tabDefinitions: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'main', label: 'Main workflow' },
  { id: 'actions', label: 'Action history' },
  { id: 'debug', label: 'Realtime debug' },
];

export function AppShell(props: AppShellProps) {
  const activeTabLabel =
    tabDefinitions.find((tab) => tab.id === props.workspaceTab)?.label ?? 'Main workflow';

  return (
    <div className="app-shell">
      <header className="shell-header">
        <div className="shell-copy">
          <p className="eyebrow">OpenClaw internal console</p>
          <h1>claw-trace v2</h1>
          <p className="shell-lede">
            Default IA follows the v1 path: choose a session, pick a terminal message, then inspect
            the agentic chain that produced it.
          </p>
        </div>

        <div className="header-meta">
          <div className="meta-card">
            <span className="meta-label">Session</span>
            <code>{props.selectedSessionId ?? 'none'}</code>
          </div>
          <div className="meta-card">
            <span className="meta-label">Terminal</span>
            <span>{props.selectedTerminalLabel ?? 'none'}</span>
          </div>
          <div className="meta-card">
            <span className="meta-label">View</span>
            <span>{activeTabLabel}</span>
          </div>
        </div>
      </header>

      <main className="workspace-shell">
        <section className="panel panel-sessions">{props.sessionPanel}</section>

        <section className="workspace-stage">
          <div className="workspace-nav">
            <div className="segmented-control workspace-tabs" role="tablist" aria-label="Workspace view">
              {tabDefinitions.map((tab) => (
                <button
                  key={tab.id}
                  id={`workspace-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={props.workspaceTab === tab.id}
                  aria-controls={`workspace-panel-${tab.id}`}
                  className={`segment-button workspace-tab ${
                    props.workspaceTab === tab.id ? 'is-active' : ''
                  }`}
                  onClick={() => props.onTabChange(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <p className="supporting-text">
              `Action history` and `Realtime debug` stay available without replacing the primary
              session to terminal to chain workflow.
            </p>
          </div>

          <div
            id="workspace-panel-main"
            role="tabpanel"
            aria-labelledby="workspace-tab-main"
            className="workspace-tab-panel workspace-tab-panel-main"
            hidden={props.workspaceTab !== 'main'}
          >
            {props.mainPanel}
          </div>
          <div
            id="workspace-panel-actions"
            role="tabpanel"
            aria-labelledby="workspace-tab-actions"
            className="workspace-tab-panel workspace-tab-panel-actions"
            hidden={props.workspaceTab !== 'actions'}
          >
            {props.actionPanel}
          </div>
          <div
            id="workspace-panel-debug"
            role="tabpanel"
            aria-labelledby="workspace-tab-debug"
            className="workspace-tab-panel workspace-tab-panel-debug"
            hidden={props.workspaceTab !== 'debug'}
          >
            {props.debugPanel}
          </div>
        </section>
      </main>
    </div>
  );
}
