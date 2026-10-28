// ============================================================
// Content calendar vocabulary. The three closed lists mirror the
// CHECK constraints in 104_content_calendar.sql — change both
// together. Labels live in messages/*.json under Calendar.
// ============================================================

/** Categories and their goal, from the marketing Excel's legend. */
export const CONTENT_CATEGORIES = [
  'community',
  'informative',
  'promotions',
  'branding',
  'reviews',
  'humor',
  'product',
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const CONTENT_FORMATS = [
  'carousel',
  'reel',
  'post',
  'story',
  'video',
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

/** In workflow order: the calendar moves a post left to right. */
export const CONTENT_STATUSES = [
  'pending',
  'in_progress',
  'review',
  'published',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** Chip colour per category: left border + tint, readable in both themes. */
export const CATEGORY_CHIP_CLASS: Record<ContentCategory, string> = {
  community: 'border-l-sky-500 bg-sky-500/10',
  informative: 'border-l-indigo-500 bg-indigo-500/10',
  promotions: 'border-l-rose-500 bg-rose-500/10',
  branding: 'border-l-violet-500 bg-violet-500/10',
  reviews: 'border-l-teal-500 bg-teal-500/10',
  humor: 'border-l-amber-500 bg-amber-500/10',
  product: 'border-l-emerald-500 bg-emerald-500/10',
};

export const CATEGORY_DOT_CLASS: Record<ContentCategory, string> = {
  community: 'bg-sky-500',
  informative: 'bg-indigo-500',
  promotions: 'bg-rose-500',
  branding: 'bg-violet-500',
  reviews: 'bg-teal-500',
  humor: 'bg-amber-500',
  product: 'bg-emerald-500',
};

export const STATUS_BADGE_CLASS: Record<ContentStatus, string> = {
  pending: 'border-border bg-muted text-muted-foreground',
  in_progress: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  review:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  published:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

function oneOf<T extends string>(list: readonly T[], fallback: T) {
  return (value: unknown): T =>
    (list as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

export const toCategory = oneOf(CONTENT_CATEGORIES, 'product');
export const toFormat = oneOf(CONTENT_FORMATS, 'carousel');
export const toStatus = oneOf(CONTENT_STATUSES, 'pending');

/** Not published and its day has passed. */
export function isOverdue(
  post: { status: ContentStatus; publish_date: string },
  today: string
) {
  return post.status !== 'published' && post.publish_date < today;
}
