import type { ReactNode } from 'react';

import type { AgentWorkspaceOption } from '../lib/api';
import type { WorkspaceTab } from '../store/app-store';

type AppShellProps = {
  sessionPanel: ReactNode;
  mainPanel: ReactNode;
  actionPanel: ReactNode;
  debugPanel: ReactNode;
  selectedSessionId: string | null;
  selectedTerminalLabel: string | null;
  selectedWorkspaceId: string;
  workspaceOptions: AgentWorkspaceOption[];
  workspaceTab: WorkspaceTab;
  onWorkspaceChange: (workspaceId: string) => void;
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
            Choose an agent workspace, then inspect sessions, terminal messages, and agentic
            chains from that OpenClaw agent.
          </p>
        </div>

        <div className="header-meta">
          <label className="meta-card meta-card-select">
            <span className="meta-label">Agent workspace</span>
            <select
              className="meta-select"
              value={props.selectedWorkspaceId}
              onChange={(event) => props.onWorkspaceChange(event.target.value)}
            >
              {props.workspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.label} ({workspace.sessionCount})
                </option>
              ))}
            </select>
          </label>
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
              Sessions now follow the selected OpenClaw agent workspace instead of always pinning to
              `main`.
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
