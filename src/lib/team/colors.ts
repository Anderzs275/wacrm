// ============================================================
// Team label colours. `team_groups.color` is free text in the
// database (see 101_team_space.sql); this list is the only set the
// app writes, and anything else reads back as the default.
// ============================================================

export const TEAM_COLORS = [
  'ocean',
  'emerald',
  'amber',
  'rose',
  'violet',
  'slate',
] as const;

export type TeamColor = (typeof TEAM_COLORS)[number];

export const DEFAULT_TEAM_COLOR: TeamColor = 'ocean';

export function toTeamColor(value: unknown): TeamColor {
  return (TEAM_COLORS as readonly unknown[]).includes(value)
    ? (value as TeamColor)
    : DEFAULT_TEAM_COLOR;
}

/** Chip classes per colour: tinted background, readable in both themes. */
export const TEAM_CHIP_CLASS: Record<TeamColor, string> = {
  ocean: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  emerald:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  amber:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  violet:
    'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  slate:
    'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
};

/** Solid swatch for the colour picker. */
export const TEAM_SWATCH_CLASS: Record<TeamColor, string> = {
  ocean: 'bg-sky-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
  slate: 'bg-slate-500',
};
