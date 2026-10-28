'use client';

// ============================================================
// Colecciones tab: every collection launch on a board by stage, so
// the team and Braulio see at a glance what is in design, in samples,
// in production… and how far each checklist is. Dragging a card moves
// its stage; clicking opens it with its tasks.
// ============================================================

import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarClock, ListChecks, Plus, Rocket } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { KanbanBoard } from '@/components/kanban/kanban-board';
import { Initials } from '@/components/team/initials';
import type { ContentBrand } from '@/components/calendar/use-content-calendar';
import { fromIsoDay, type IsoDay } from '@/lib/calendar/month-grid';
import {
  COLLECTION_STAGES,
  COLLECTION_STAGE_ACCENT,
  daysUntil,
  progressOf,
  type CollectionStage,
} from '@/lib/team/work-meta';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import {
  CollectionDialog,
  collectionDraftFrom,
  newCollectionDraft,
  type CollectionDraft,
} from './collection-dialog';
import type { Collection } from './use-collections';

export function CollectionsTab({
  collections,
  brands,
  members,
  today,
  canDelete,
  onChanged,
  draft,
  onDraftChange,
}: {
  collections: Collection[];
  brands: ContentBrand[];
  members: AccountMember[];
  today: IsoDay;
  canDelete: boolean;
  onChanged: () => void;
  /** Lifted so the calendar's 🚀 chips can open a collection here. */
  draft: CollectionDraft | null;
  onDraftChange: (draft: CollectionDraft | null) => void;
}) {
  const t = useTranslations('Collections');
  const format = useFormatter();

  const nameOf = (id: string | null) =>
    members.find((m) => m.user_id === id)?.full_name ?? '';

  const upcoming = collections
    .filter(
      (c) => c.launch_date && c.launch_date >= today && c.stage !== 'launched'
    )
    .sort((a, b) =>
      (a.launch_date ?? '').localeCompare(b.launch_date ?? '')
    )[0];

  async function move(c: Collection, stage: CollectionStage) {
    const { error } = await createClient()
      .from('collections')
      .update({ stage })
      .eq('id', c.id);
    if (error) {
      toast.error(t('saveFailed'), { description: error.message });
      return;
    }
    onChanged();
  }

  const countdown = (day: IsoDay) => {
    const n = daysUntil(today, day);
    if (n === 0) return t('countdown.today');
    return n > 0 ? t('countdown.in', { n }) : t('countdown.ago', { n: -n });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>
        {upcoming?.launch_date && (
          <div className="border-border bg-card flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
            <Rocket className="h-4 w-4 text-orange-500" />
            <span>
              {t('next', { name: upcoming.name })}{' '}
              <span className="font-semibold">
                {countdown(upcoming.launch_date)}
              </span>
            </span>
          </div>
        )}
        <Button onClick={() => onDraftChange(newCollectionDraft())}>
          <Plus className="h-4 w-4" />
          {t('new')}
        </Button>
      </div>

      <KanbanBoard
        columns={COLLECTION_STAGES.map((s) => ({
          key: s,
          label: t(`stage.${s}`),
          accent: COLLECTION_STAGE_ACCENT[s],
        }))}
        items={collections}
        columnOf={(c) => c.stage}
        onMove={(c, to) => void move(c, to)}
        onAdd={(stage) => onDraftChange(newCollectionDraft(stage))}
        addLabel={t('new')}
        emptyLabel={t('empty')}
        renderCard={(c) => {
          const progress = progressOf(c.tasks);
          const lateTasks = c.tasks.filter(
            (task) => !task.done && task.due_date && task.due_date < today
          ).length;
          const launchPast =
            c.launch_date && c.launch_date < today && c.stage !== 'launched';
          return (
            <button
              type="button"
              onClick={() => onDraftChange(collectionDraftFrom(c))}
              className="border-border bg-card hover:border-primary/40 w-full rounded-lg border p-2.5 text-left shadow-sm transition-colors"
            >
              <p className="line-clamp-2 text-sm font-semibold">{c.name}</p>
              <p className="text-muted-foreground text-xs">
                {brands.find((b) => b.id === c.brand_id)?.name ?? '—'}
              </p>
              {c.launch_date && (
                <p
                  className={cn(
                    'mt-1.5 flex items-center gap-1 text-xs',
                    launchPast
                      ? 'font-semibold text-red-600 dark:text-red-400'
                      : 'text-muted-foreground'
                  )}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  {format.dateTime(fromIsoDay(c.launch_date), {
                    day: 'numeric',
                    month: 'short',
                  })}
                  {c.stage !== 'launched' && ` · ${countdown(c.launch_date)}`}
                </p>
              )}
              {progress !== null && (
                <div className="mt-2 space-y-1">
                  <div className="text-muted-foreground flex items-center gap-1 text-[11px]">
                    <ListChecks className="h-3 w-3" />
                    {t('tasks.progress', {
                      done: c.tasks.filter((x) => x.done).length,
                      total: c.tasks.length,
                    })}
                    {lateTasks > 0 && (
                      <span className="ml-auto font-medium text-red-600 dark:text-red-400">
                        {t('tasks.late', { n: lateTasks })}
                      </span>
                    )}
                  </div>
                  <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
              {c.owner_id && (
                <div className="mt-2 flex justify-end">
                  <Initials names={[nameOf(c.owner_id) || '?']} />
                </div>
              )}
            </button>
          );
        }}
      />

      <CollectionDialog
        draft={draft}
        collections={collections}
        brands={brands}
        members={members}
        canDelete={canDelete}
        onClose={() => onDraftChange(null)}
        onChanged={onChanged}
      />
    </div>
  );
}
