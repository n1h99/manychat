import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('workspace lifecycle UI contracts', () => {
  it('keeps login validation while hiding required marks', () => {
    const login = source('./pages/login-page.tsx');
    expect(login).toContain('requiredMark={false}');
    expect(login).toContain("rules={[{ required: true, type: 'email' }]}");
    expect(login).toContain('rules={[{ required: true }]}');
  });

  it('locks canvas zoom together with editor interactivity', () => {
    const editor = source('./pages/scenario-editor-page.tsx');
    expect(editor).toContain('zoomOnScroll={isCanvasInteractive}');
    expect(editor).toContain('zoomOnPinch={isCanvasInteractive}');
    expect(editor).toContain('showZoom={isCanvasInteractive}');
  });

  it('saves automation drafts only after an explicit Save draft action', () => {
    const editor = source('./pages/scenario-editor-page.tsx');
    expect(editor).toContain('onFinish={save}');
    expect(editor).toContain('Unsaved changes');
    expect(editor).toContain('setManualSavePending(true)');
    expect(editor).not.toContain('updateDraftRef');
    expect(editor).not.toContain('Autosave stopped');
    expect(editor).not.toContain('}, 1_500)');
  });

  it('keeps Automation Studio discovery, locking and diagnostics operator-friendly', () => {
    const editor = source('./pages/scenario-editor-page.tsx');
    const testPanel = source('./automation-test-panel.tsx');
    expect(editor).toContain('const hydratedGraph = flowToScenarioGraph');
    expect(editor).toContain('placeholder="Find a step"');
    expect(editor).toContain('disabled={!isCanvasInteractive || !historyPast.length}');
    expect(editor).toContain(
      "deleteKeyCode={isCanvasInteractive ? ['Backspace', 'Delete'] : null}",
    );
    expect(editor).toContain('candidate.id !== scenarioId');
    expect(editor).toContain('<AutomationGraphPreview compact graph={version.graph} />');
    expect(editor).toContain('Telegram delivery');
    expect(testPanel).toContain("nodeTypes.includes('WAIT_FOR_REPLY')");
    expect(testPanel).toContain("nodeTypes.includes('EXTERNAL_HTTP_REQUEST')");
    expect(testPanel).toContain('Fix the graph before testing');
  });

  it('uses an in-app template archive dialog and a deferred media selection', () => {
    const templates = source('./pages/templates-page.tsx');
    const media = source('./pages/media-assets-page.tsx');
    expect(templates).not.toContain('Modal.confirm');
    expect(templates).toContain('Archive template');
    expect(media).toContain('showUploadList={false}');
    expect(media).toContain('Remove selected file');
  });

  it('provides discoverable archive and restore views', () => {
    const fields = source('./pages/custom-fields-page.tsx');
    const templates = source('./pages/templates-page.tsx');
    const broadcasts = source('./pages/broadcasts-page.tsx');
    expect(fields).toContain("label: 'Archived'");
    expect(fields).toContain('Restore');
    expect(templates).toContain("label: 'Archived'");
    expect(templates).toContain('Restore');
    expect(broadcasts).toContain("label: 'Archived'");
    expect(broadcasts).toContain('Restore');
    expect(fields).toContain('className="archive-state-table"');
    expect(templates).toContain('className="archive-state-table"');
    expect(broadcasts).toContain('className="archive-state-table"');
    expect(fields).toContain('tableLayout="fixed"');
    expect(templates).toContain('tableLayout="fixed"');
    expect(broadcasts).toContain('tableLayout="fixed"');
  });

  it('removes campaign labels and keeps stable scenario action widths', () => {
    const broadcasts = source('./pages/broadcasts-page.tsx');
    const scenarios = source('./pages/scenarios-page.tsx');
    expect(broadcasts.toLowerCase()).not.toContain('campaign');
    expect(scenarios).toContain('scenario-state-action');
    expect(scenarios).toContain('width: 250');
  });

  it('uses fully clickable project rows and removes page kickers', () => {
    const projects = source('./pages/projects-page.tsx');
    const shell = source('./app-shell.tsx');
    expect(projects).toContain('onRow={(project) =>');
    expect(projects).toContain('rowClassName="clickable-row"');
    expect(projects).toContain("role: 'link'");
    expect(projects).not.toContain('header-kicker');
    expect(shell).not.toContain('header-kicker');
  });

  it('keeps the account header compact and archive switches consistent', () => {
    const styles = source('./styles.css');
    const theme = source('./main.tsx');
    expect(styles).toMatch(/\.app-header\s*\{[^}]*line-height: normal;/s);
    expect(styles).toMatch(/\.account-identity-chip\s*\{[^}]*height: 38px;/s);
    expect(styles).toMatch(/\.account-identity-chip\s*\{[^}]*line-height: normal;/s);
    expect(styles).toContain('padding: 5px');
    expect(styles).toContain('border-radius: 18px');
    expect(styles).toContain('background: rgba(15, 118, 110, 0.1)');
    expect(theme).toContain('Segmented: {');
    expect(theme).toContain("itemSelectedColor: '#0f766e'");
  });

  it('uses a full-width connection overview and stacked channel controls', () => {
    const channel = source('./pages/channel-detail-page.tsx');
    const styles = source('./styles.css');
    expect(channel).toContain('className="channel-overview-card"');
    expect(channel).toContain('className="channel-management-grid"');
    expect(channel).toContain('className="channel-management-stack"');
    expect(channel).toContain('className="channel-actions-card"');
    expect(channel).toContain('className="channel-test-message-card"');
    expect(channel).toContain('Telegram delivery has an unknown result');
    expect(channel).toContain('Telegram inbound processing failed');
    expect(channel.indexOf('Replace bot token')).toBeLessThan(
      channel.indexOf('Connection actions'),
    );
    expect(styles).toContain('grid-template-columns: minmax(320px, 0.85fr) minmax(420px, 1.15fr)');
    expect(styles).toContain('grid-template-rows: auto 1fr');
    expect(styles).toContain('align-items: stretch');
    expect(styles).toMatch(/\.channel-management-grid\s*\{\s*grid-template-columns: 1fr;/);
  });

  it('does not show internal unknown-delivery guidance as a page banner', () => {
    expect(source('./pages/crm-config-page.tsx')).not.toContain(
      'Unknown delivery requires confirmation',
    );
  });

  it('exposes the completed operations and account lifecycle surfaces safely', () => {
    const operations = source('./pages/operations-page.tsx');
    const settings = source('./pages/project-settings-page.tsx');
    const users = source('./pages/users-page.tsx');
    const health = source('./pages/system-health-page.tsx');
    expect(operations).toContain('Reconcile unknown outcome');
    expect(operations).toContain('Retry terminal operation');
    expect(operations).toContain('Audit log');
    expect(settings).toContain('Contacts, channels, credentials');
    expect(settings).toContain('canClone');
    expect(users).toContain('Create invitation');
    expect(users).toContain('Create one-time password reset link');
    expect(health).toContain('System health');
    expect(health).toContain('No Sentry dependency');
  });
});
