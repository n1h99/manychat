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

  it('does not show internal unknown-delivery guidance as a page banner', () => {
    expect(source('./pages/crm-config-page.tsx')).not.toContain(
      'Unknown delivery requires confirmation',
    );
  });
});
