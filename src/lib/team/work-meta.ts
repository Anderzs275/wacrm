// ============================================================
// Vocabulary for the Colecciones and Colaboraciones tabs. Each list
// mirrors a CHECK constraint in 108_collections_collaborations.sql —
// change both together. Labels live in messages/*.json under
// Collections / Collabs.
// ============================================================

function oneOf<T extends string>(list: readonly T[], fallback: T) {
  return (value: unknown): T =>
    (list as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/** A collection's path to launch, left to right on the board. */
export const COLLECTION_STAGES = [
  'idea',
  'design',
  'samples',
  'production',
  'photoshoot',
  'launch_prep',
  'launched',
] as const;
export type CollectionStage = (typeof COLLECTION_STAGES)[number];
export const toCollectionStage = oneOf(COLLECTION_STAGES, 'idea');

export const COLLECTION_STAGE_ACCENT: Record<CollectionStage, string> = {
  idea: 'bg-slate-400',
  design: 'bg-violet-500',
  samples: 'bg-sky-500',
  production: 'bg-amber-500',
  photoshoot: 'bg-pink-500',
  launch_prep: 'bg-orange-500',
  launched: 'bg-emerald-500',
};

/** An influencer / brand collab, left to right on the board. */
export const COLLAB_STATUSES = [
  'prospect',
  'contacted',
  'negotiating',
  'agreed',
  'in_progress',
  'published',
  'declined',
] as const;
export type CollabStatus = (typeof COLLAB_STATUSES)[number];
export const toCollabStatus = oneOf(COLLAB_STATUSES, 'prospect');

export const COLLAB_STATUS_ACCENT: Record<CollabStatus, string> = {
  prospect: 'bg-slate-400',
  contacted: 'bg-sky-500',
  negotiating: 'bg-amber-500',
  agreed: 'bg-violet-500',
  in_progress: 'bg-orange-500',
  published: 'bg-emerald-500',
  declined: 'bg-red-500',
};

export const COLLAB_KINDS = ['exchange', 'paid', 'affiliate', 'other'] as const;
export type CollabKind = (typeof COLLAB_KINDS)[number];
export const toCollabKind = oneOf(COLLAB_KINDS, 'exchange');

export const COLLAB_PLATFORMS = [
  'instagram',
  'tiktok',
  'youtube',
  'other',
] as const;
export type CollabPlatform = (typeof COLLAB_PLATFORMS)[number];
export const toCollabPlatform = oneOf(COLLAB_PLATFORMS, 'instagram');

/** Share of a checklist that is done, 0–100, or null with no tasks. */
export function progressOf(tasks: readonly { done: boolean }[]): number | null {
  if (tasks.length === 0) return null;
  return Math.round(
    (tasks.filter((task) => task.done).length / tasks.length) * 100
  );
}

/**
 * Parse an amount typed by a person ("1,500.50", "1500", "S/ 350")
 * into a number, or null when blank. Returns NaN for garbage so the
 * form can refuse it.
 */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/s\/|\s|,/gi, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : NaN;
}

/** Whole days from `from` to `to` ('YYYY-MM-DD'); negative if past. */
export function daysUntil(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000
  );
}
