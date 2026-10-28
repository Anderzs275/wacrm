// ============================================================
// Where the 'team' role may go (fork). Pure, no I/O.
//
// The role is contained by RLS (103_team_role_access.sql) and by
// `getCurrentAccount`; this list only decides which screens the app
// offers, so a designer never lands on a page that would just come up
// empty or full of errors.
// ============================================================

import type { SettingsSection } from '@/components/settings/settings-sections';

/** Dashboard routes the team role can open. First one is the landing. */
export const TEAM_ROLE_PATHS = ['/team', '/settings'] as const;

export const TEAM_ROLE_HOME = TEAM_ROLE_PATHS[0];

/** Settings sections about the person, not the workspace. */
export const TEAM_ROLE_SETTINGS: readonly SettingsSection[] = [
  'profile',
  'security',
  'appearance',
];

export function teamRoleCanVisit(pathname: string): boolean {
  return TEAM_ROLE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}
