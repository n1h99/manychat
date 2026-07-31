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

  it('uses a full-width connection overview and stacked channel controls', () => {
    const channel = source('./pages/channel-detail-page.tsx');
    const styles = source('./styles.css');
    expect(channel).toContain('className="channel-overview-card"');
    expect(channel).toContain('className="channel-management-grid"');
    expect(channel).toContain('className="channel-management-stack"');
    expect(channel).toContain('className="channel-actions-card"');
    expect(channel).toContain('className="channel-test-message-card"');
    expect(channel.indexOf('Replace bot token')).toBeLessThan(
      channel.indexOf('Connection actions'),
    );
    expect(styles).toContain('grid-template-columns: minmax(320px, 0.85fr) minmax(420px, 1.15fr)');
    expect(styles).toMatch(/\.channel-management-grid\s*\{\s*grid-template-columns: 1fr;/);
  });

  it('does not show internal unknown-delivery guidance as a page banner', () => {
    expect(source('./pages/crm-config-page.tsx')).not.toContain(
      'Unknown delivery requires confirmation',
    );
  });
});
