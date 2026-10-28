import { describe, expect, it } from 'vitest';

import { teamRoleCanVisit } from './team-role';

describe('teamRoleCanVisit', () => {
  it.each(['/team', '/settings', '/settings/anything'])('allows %s', (path) => {
    expect(teamRoleCanVisit(path)).toBe(true);
  });

  it.each([
    '/dashboard',
    '/inbox',
    '/contacts',
    '/tracking',
    '/teams',
    '/settingsx',
  ])('blocks %s', (path) => {
    expect(teamRoleCanVisit(path)).toBe(false);
  });
});
