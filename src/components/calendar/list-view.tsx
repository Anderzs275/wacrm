'use client';

// ============================================================
// "Lista" view of the content calendar: a working board in the app's
// own style (the Excel's columns, not its looks). Posts can be grouped
// by week, status or person; groups fold; status changes inline; and
// each row has Open / Duplicate / Delete without leaving the list.
// ============================================================

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ChevronDown,
  Copy,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import {
  CATEGORY_DOT_CLASS,
  CONTENT_STATUSES,
  STATUS_BADGE_CLASS,
  isOverdue,
  type ContentStatus,
} from '@/lib/calendar/content-meta';
import { fromIsoDay, monthGrid, type IsoDay } from '@/lib/calendar/month-grid';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import { Initials } from '@/components/team/initials';
import {
  saveContentPost,
  type ContentBrand,
  type ContentPost,
} from './use-content-calendar';

type GroupBy = 'week' | 'status' | 'person';

interface Group {
  key: string;
  label: string;
  /** Left accent of the group header. */
  accent: string;
  posts: ContentPost[];
  /** Day a "+ Agregar" in this group plans on. */
  addDay: IsoDay;
}

const NOBODY = 'nobody';
const COLUMNS =
  'grid grid-cols-[76px_minmax(220px,1fr)_130px_120px_96px_96px_140px_36px] items-center gap-3';

const STATUS_ACCENT: Record<ContentStatus, string> = {
  pending: 'bg-muted-foreground',
  in_progress: 'bg-sky-500',
  review: 'bg-amber-500',
  approved: 'bg-violet-500',
  published: 'bg-emerald-500',
};

export function ListView({
  month,
  today,
  posts,
  brands,
  members,
  canDelete,
  onOpenPost,
  onNewPost,
  onChanged,
}: {
  month: IsoDay;
  today: IsoDay;
  posts: ContentPost[];
  brands: ContentBrand[];
  members: AccountMember[];
  canDelete: boolean;
  onOpenPost: (post: ContentPost) => void;
  onNewPost: (day: IsoDay) => void;
  onChanged: () => void;
}) {
  const t = useTranslations('Calendar');
  const tl = useTranslations('Calendar.list');
  const format = useFormatter();
  const { accountId } = useAuth();
  const [groupBy, setGroupBy] = useState<GroupBy>('week');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState<ContentPost | null>(null);

  const inMonth = posts.filter(
    (p) => p.publish_date.slice(0, 7) === month.slice(0, 7)
  );
  const defaultDay = today.slice(0, 7) === month.slice(0, 7) ? today : month;
  const shortDay = (day: IsoDay) =>
    format.dateTime(fromIsoDay(day), { day: 'numeric', month: 'short' });

  const groups: Group[] = (() => {
    if (groupBy === 'status') {
      return CONTENT_STATUSES.map((s) => ({
        key: s,
        label: t(`status.${s}`),
        accent: STATUS_ACCENT[s],
        posts: inMonth.filter((p) => p.status === s),
        addDay: defaultDay,
      }));
    }
    if (groupBy === 'person') {
      const people: Group[] = members.map((m) => ({
        key: m.user_id,
        label: m.full_name || m.email || '—',
        accent: 'bg-primary',
        posts: inMonth.filter((p) => p.assignees.includes(m.user_id)),
        addDay: defaultDay,
      }));
      return [
        ...people,
        {
          key: NOBODY,
          label: tl('nobody'),
          accent: 'bg-muted-foreground',
          posts: inMonth.filter((p) => p.assignees.length === 0),
          addDay: defaultDay,
        },
      ].filter((g) => g.posts.length > 0 || g.key !== NOBODY);
    }
    return monthGrid(month)
      .map((week) => week.filter((d) => d.inMonth).map((d) => d.day))
      .filter((days) => days.length > 0)
      .map((days, i) => {
        const first = days[0];
        const last = days[days.length - 1];
        return {
          key: first,
          label: tl('weekLabel', {
            n: i + 1,
            from: shortDay(first),
            to: shortDay(last),
          }),
          accent: today >= first && today <= last ? 'bg-primary' : 'bg-border',
          posts: inMonth.filter(
            (p) => p.publish_date >= first && p.publish_date <= last
          ),
          addDay: today >= first && today <= last ? today : first,
        };
      });
  })();

  const brandName = (id: string | null) =>
    brands.find((b) => b.id === id)?.name ?? '';
  const memberOf = (id: string) => members.find((m) => m.user_id === id);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function setStatus(post: ContentPost, status: ContentStatus) {
    if (status === post.status) return;
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

  async function duplicate(post: ContentPost) {
    if (!accountId) return;
    try {
      await saveContentPost(
        accountId,
        null,
        {
          publish_date: post.publish_date,
          category: post.category,
          brand_id: post.brand_id,
          format: post.format,
          product: post.product,
          idea: post.idea,
          caption: post.caption,
          status: 'pending',
          assignees: post.assignees,
        },
        []
      );
      toast.success(tl('duplicated'));
      onChanged();
    } catch (err) {
      toast.error(t('saveFailed'), {
        description: (err as { message?: string })?.message,
      });
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    const { error } = await createClient()
      .from('content_posts')
      .delete()
      .eq('id', deleting.id);
    if (error) {
      toast.error(t('deleteFailed'), { description: error.message });
      return;
    }
    setDeleting(null);
    onChanged();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">{tl('groupBy')}</span>
        <div className="border-border flex rounded-lg border p-0.5">
          {(['week', 'status', 'person'] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={groupBy === g}
              onClick={() => setGroupBy(g)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium',
                groupBy === g
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tl(`group.${g}`)}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground ml-auto text-xs">
          {tl('count', { n: inMonth.length })}
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[960px] space-y-3">
          <div
            className={cn(
              COLUMNS,
              'text-muted-foreground px-3 text-[11px] font-medium tracking-wide uppercase'
            )}
          >
            <span>{t('fields.date')}</span>
            <span>{tl('post')}</span>
            <span>{t('fields.category')}</span>
            <span>{t('fields.brand')}</span>
            <span>{t('fields.format')}</span>
            <span>{t('fields.assignees')}</span>
            <span>{t('fields.status')}</span>
            <span />
          </div>

          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            return (
              <section
                key={group.key}
                className="border-border bg-card overflow-hidden rounded-lg border"
              >
                <button
                  type="button"
                  onClick={() => toggle(group.key)}
                  aria-expanded={!isCollapsed}
                  className="hover:bg-muted/40 flex w-full items-center gap-2 px-3 py-2 text-left"
                >
                  <span className={cn('h-4 w-1 rounded-full', group.accent)} />
                  <ChevronDown
                    className={cn(
                      'text-muted-foreground h-4 w-4 transition-transform',
                      isCollapsed && '-rotate-90'
                    )}
                  />
                  <span className="text-sm font-semibold">{group.label}</span>
                  <span className="bg-muted text-muted-foreground rounded-full px-2 text-xs">
                    {group.posts.length}
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="border-border divide-border divide-y border-t">
                    {group.posts.map((p) => (
                      <div
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenPost(p)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onOpenPost(p);
                        }}
                        className={cn(
                          COLUMNS,
                          'hover:bg-muted/40 cursor-pointer px-3 py-2 text-sm'
                        )}
                      >
                        <span
                          className={cn(
                            'text-xs whitespace-nowrap first-letter:uppercase',
                            p.publish_date === today
                              ? 'text-primary font-semibold'
                              : isOverdue(p, today)
                                ? 'font-medium text-red-600 dark:text-red-400'
                                : 'text-muted-foreground'
                          )}
                        >
                          {format.dateTime(fromIsoDay(p.publish_date), {
                            weekday: 'short',
                            day: 'numeric',
                          })}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {p.product || p.idea || t(`category.${p.category}`)}
                          </span>
                          {p.product && p.idea && (
                            <span className="text-muted-foreground block truncate text-xs">
                              {p.idea}
                            </span>
                          )}
                        </span>
                        <span
                          title={t(`categoryGoal.${p.category}`)}
                          className="bg-muted flex w-fit max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs"
                        >
                          <span
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              CATEGORY_DOT_CLASS[p.category]
                            )}
                          />
                          {t(`category.${p.category}`)}
                        </span>
                        <span className="truncate text-xs">
                          {brandName(p.brand_id) || (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {t(`format.${p.format}`)}
                        </span>
                        <span>
                          {p.assignees.length === 0 ? (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
                          ) : (
                            <Initials
                              names={p.assignees.map(
                                (id) => memberOf(id)?.full_name || '?'
                              )}
                            />
                          )}
                        </span>
                        <span
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Select
                            value={p.status}
                            onValueChange={(v) =>
                              v && void setStatus(p, v as ContentStatus)
                            }
                          >
                            <SelectTrigger
                              size="sm"
                              className={cn(
                                'h-7 w-full rounded-full border text-xs font-medium',
                                STATUS_BADGE_CLASS[p.status]
                              )}
                            >
                              <SelectValue>
                                {t(`status.${p.status}`)}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {CONTENT_STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {t(`status.${s}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </span>
                        <span
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label={tl('actions')}
                              className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 items-center justify-center rounded-md"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem onClick={() => onOpenPost(p)}>
                                <Pencil />
                                {tl('open')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => void duplicate(p)}
                              >
                                <Copy />
                                {tl('duplicate')}
                              </DropdownMenuItem>
                              {canDelete && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => setDeleting(p)}
                                  >
                                    <Trash2 />
                                    {t('delete')}
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </span>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => onNewPost(group.addDay)}
                      className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {tl('add')}
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{tl('deleteTitle')}</DialogTitle>
            <DialogDescription>
              {deleting?.product || deleting?.idea}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => void handleDelete()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
