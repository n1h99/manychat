import { describe, expect, it } from 'vitest';

import { breadcrumbsFor } from './breadcrumbs';

describe('breadcrumbsFor', () => {
  it('builds a navigable project hierarchy', () => {
    expect(breadcrumbsFor('/projects/project-a/contacts/contact-a')).toEqual([
      { label: 'Projects', path: '/projects' },
      { label: 'Project', path: '/projects/project-a' },
      { label: 'Contacts', path: '/projects/project-a/contacts' },
      { label: 'Contact details' },
    ]);
  });

  it('labels creation routes without exposing identifiers', () => {
    expect(breadcrumbsFor('/projects/project-a/channels/new')).toEqual([
      { label: 'Projects', path: '/projects' },
      { label: 'Project', path: '/projects/project-a' },
      { label: 'Channels', path: '/projects/project-a/channels' },
      { label: 'Connect Telegram' },
    ]);
  });

  it('keeps root routes concise', () => {
    expect(breadcrumbsFor('/projects')).toEqual([{ label: 'Projects' }]);
    expect(breadcrumbsFor('/users')).toEqual([{ label: 'Users' }]);
  });
});
