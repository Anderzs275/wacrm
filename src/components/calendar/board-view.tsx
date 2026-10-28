'use client';

// ============================================================
// "Tablero" view of the content calendar: the month's posts as cards
// in one column per status, dragged along like a Trello board.
// Dropping a card changes its status; clicking it opens the post.
// ============================================================

import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { KanbanBoard } from '@/components/kanban/kanban-board';
import { createClient } from '@/lib/supabase/client';
import {
  CATEGORY_DOT_CLASS,
  CONTENT_STATUSES,
  isOverdue,
  type ContentStatus,
} from '@/lib/calendar/content-meta';
import { fromIsoDay, type IsoDay } from '@/lib/calendar/month-grid';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import { Initials } from '@/components/team/initials';
import type { ContentBrand, ContentPost } from './use-content-calendar';

const STATUS_ACCENT: Record<ContentStatus, string> = {
  pending: 'bg-slate-400',
  in_progress: 'bg-sky-500',
  review: 'bg-amber-500',
  published: 'bg-emerald-500',
};

export function BoardView({
  month,
  today,
  posts,
  brands,
  members,
  onOpenPost,
  onNewPost,
  onChanged,
}: {
  month: IsoDay;
  today: IsoDay;
  posts: ContentPost[];
  brands: ContentBrand[];
  members: AccountMember[];
  onOpenPost: (post: ContentPost) => void;
  onNewPost: (day: IsoDay, status?: ContentStatus) => void;
  onChanged: () => void;
}) {
  const t = useTranslations('Calendar');
  const format = useFormatter();
  const inMonth = posts.filter(
    (p) => p.publish_date.slice(0, 7) === month.slice(0, 7)
  );
  const defaultDay = today.slice(0, 7) === month.slice(0, 7) ? today : month;

  async function move(post: ContentPost, status: ContentStatus) {
    const { error } = await createClient()
      .from('content_posts')
      .update({ status })
      .eq('id', post.id);
    if (error) {
      toast.error(t('saveFailed'), { description: error.message });
      return;
    }
    onChanged();
  }

  return (
    <KanbanBoard
      columns={CONTENT_STATUSES.map((s) => ({
        key: s,
        label: t(`status.${s}`),
        accent: STATUS_ACCENT[s],
      }))}
      items={inMonth}
      columnOf={(p) => p.status}
      onMove={(p, to) => void move(p, to)}
      onAdd={(status) => onNewPost(defaultDay, status)}
      addLabel={t('list.add')}
      emptyLabel={t('board.empty')}
      renderCard={(p) => (
        <button
          type="button"
          onClick={() => onOpenPost(p)}
          className="border-border bg-card hover:border-primary/40 w-full rounded-lg border p-2.5 text-left shadow-sm transition-colors"
        >
          <div className="flex items-center gap-1.5 text-[11px]">
            <span
              className={cn(
                'size-2 rounded-full',
                CATEGORY_DOT_CLASS[p.category]
              )}
            />
            <span className="text-muted-foreground">
              {t(`category.${p.category}`)}
            </span>
            <span
              className={cn(
                'ml-auto first-letter:uppercase',
                p.publish_date === today
                  ? 'text-primary font-semibold'
                  : isOverdue(p, today)
                    ? 'font-semibold text-red-600 dark:text-red-400'
                    : 'text-muted-foreground'
              )}
            >
              {format.dateTime(fromIsoDay(p.publish_date), {
                weekday: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm font-medium">
            {p.product || p.idea || t(`category.${p.category}`)}
          </p>
          {p.product && p.idea && (
            <p className="text-muted-foreground line-clamp-1 text-xs">
              {p.idea}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-muted-foreground truncate text-[11px]">
              {[
                brands.find((b) => b.id === p.brand_id)?.name,
                t(`format.${p.format}`),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <Initials
              className="ml-auto"
              names={p.assignees.map(
                (id) => members.find((m) => m.user_id === id)?.full_name ?? '?'
              )}
            />
          </div>
        </button>
      )}
    />
  );
}
