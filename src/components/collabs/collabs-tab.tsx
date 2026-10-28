'use client';

// ============================================================
// Colaboraciones tab: influencer and brand collabs on a board by
// status, from "por contactar" to "publicado". Each column shows what
// its paid deals add up to, and the header what is committed (agreed
// onwards), so Braulio can see the spend without a spreadsheet.
// ============================================================

import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarClock, ExternalLink, Plus } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { KanbanBoard } from '@/components/kanban/kanban-board';
import { Initials } from '@/components/team/initials';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { fromIsoDay, type IsoDay } from '@/lib/calendar/month-grid';
import {
  COLLAB_STATUSES,
  COLLAB_STATUS_ACCENT,
  type CollabStatus,
} from '@/lib/team/work-meta';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import {
  CollabDialog,
  collabDraftFrom,
  newCollabDraft,
  type CollabDraft,
} from './collab-dialog';
import type { Collaboration } from './use-collaborations';

/** Statuses whose amount counts as committed spend. */
const COMMITTED: readonly CollabStatus[] = [
  'agreed',
  'in_progress',
  'published',
];

export function CollabsTab({
  collabs,
  members,
  today,
  canDelete,
  onChanged,
  draft,
  onDraftChange,
}: {
  collabs: Collaboration[];
  members: AccountMember[];
  today: IsoDay;
  canDelete: boolean;
  onChanged: () => void;
  draft: CollabDraft | null;
  onDraftChange: (draft: CollabDraft | null) => void;
}) {
  const t = useTranslations('Collabs');
  const format = useFormatter();
  const { defaultCurrency } = useAuth();
  const money = (n: number) => formatCurrency(n, defaultCurrency);
  const sum = (list: Collaboration[]) =>
    list.reduce((total, c) => total + (c.amount ?? 0), 0);

  const committed = sum(collabs.filter((c) => COMMITTED.includes(c.status)));
  const live = collabs.filter(
    (c) => c.status === 'agreed' || c.status === 'in_progress'
  ).length;

  async function move(c: Collaboration, status: CollabStatus) {
    const { error } = await createClient()
      .from('collaborations')
      .update({ status })
      .eq('id', c.id);
    if (error) {
      toast.error(t('saveFailed'), { description: error.message });
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>
        <div className="border-border bg-card rounded-lg border px-3 py-1.5 text-sm">
          {t('summary', { live, amount: money(committed) })}
        </div>
        <Button onClick={() => onDraftChange(newCollabDraft())}>
          <Plus className="h-4 w-4" />
          {t('new')}
        </Button>
      </div>

      <KanbanBoard
        columns={COLLAB_STATUSES.map((s) => {
          const total = sum(collabs.filter((c) => c.status === s));
          return {
            key: s,
            label: t(`status.${s}`),
            accent: COLLAB_STATUS_ACCENT[s],
            hint: total > 0 ? money(total) : undefined,
          };
        })}
        items={collabs}
        columnOf={(c) => c.status}
        onMove={(c, to) => void move(c, to)}
        onAdd={(status) => onDraftChange(newCollabDraft(status))}
        addLabel={t('new')}
        emptyLabel={t('empty')}
        renderCard={(c) => (
          <div
            role="button"
            tabIndex={0}
            onClick={() => onDraftChange(collabDraftFrom(c))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onDraftChange(collabDraftFrom(c));
            }}
            className="border-border bg-card hover:border-primary/40 w-full cursor-pointer rounded-lg border p-2.5 text-left shadow-sm transition-colors"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {[c.handle, t(`platform.${c.platform}`)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {c.url && (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={t('openProfile')}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="bg-muted rounded-full px-2 py-0.5">
                {t(`kind.${c.kind}`)}
              </span>
              {c.amount !== null && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                  {money(c.amount)}
                </span>
              )}
            </div>
            {c.products && (
              <p className="text-muted-foreground mt-1.5 line-clamp-1 text-xs">
                {c.products}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              {c.publish_date && (
                <span
                  className={cn(
                    'flex items-center gap-1 text-xs',
                    c.publish_date < today && c.status !== 'published'
                      ? 'font-semibold text-red-600 dark:text-red-400'
                      : 'text-muted-foreground'
                  )}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  {format.dateTime(fromIsoDay(c.publish_date), {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              )}
              {c.owner_id && (
                <Initials
                  className="ml-auto"
                  names={[
                    members.find((m) => m.user_id === c.owner_id)?.full_name ??
                      '?',
                  ]}
                />
              )}
            </div>
          </div>
        )}
      />

      <CollabDialog
        draft={draft}
        members={members}
        canDelete={canDelete}
        onClose={() => onDraftChange(null)}
        onChanged={onChanged}
      />
    </div>
  );
}
