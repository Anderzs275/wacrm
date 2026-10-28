'use client';

// ============================================================
// Agenda: what is overdue, what is on today and what is coming in the
// next AGENDA_DAYS, grouped by day, with meetings (and their Join
// button) alongside the posts. "Lo mío" narrows it to the posts the
// viewer is assigned to, so each person sees their own list first.
// ============================================================

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ExternalLink, Star, Video } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  CATEGORY_DOT_CLASS,
  STATUS_BADGE_CLASS,
  isOverdue,
} from '@/lib/calendar/content-meta';
import { fromIsoDay, type IsoDay } from '@/lib/calendar/month-grid';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import {
  AGENDA_DAYS,
  type CalendarOccurrence,
  type ContentBrand,
  type ContentPost,
} from './use-content-calendar';

export function TodayCard({
  posts,
  events,
  brands,
  today,
  members,
  currentUserId,
  onOpenPost,
  onOpenEvent,
}: {
  posts: ContentPost[];
  events: CalendarOccurrence[];
  brands: ContentBrand[];
  today: IsoDay;
  members: AccountMember[];
  currentUserId: string | null;
  onOpenPost: (post: ContentPost) => void;
  onOpenEvent: (event: CalendarOccurrence) => void;
}) {
  const t = useTranslations('Calendar.todayCard');
  const tc = useTranslations('Calendar');
  const format = useFormatter();
  const [mine, setMine] = useState(false);

  const visible =
    mine && currentUserId
      ? posts.filter((p) => p.assignees.includes(currentUserId))
      : posts;
  const overdue = visible.filter((p) => isOverdue(p, today));
  const upcoming = visible.filter((p) => p.publish_date >= today);
  const pendingToday = upcoming.filter(
    (p) => p.publish_date === today && p.status !== 'published'
  ).length;
  const pendingWeek = upcoming.filter((p) => p.status !== 'published').length;

  // Days that have anything, in order; today always shows.
  const days = [
    ...new Set([
      today,
      ...upcoming.map((p) => p.publish_date),
      ...events.map((e) => e.day),
    ]),
  ].sort();

  const nameOf = (userId: string) =>
    members.find((m) => m.user_id === userId)?.full_name?.split(' ')[0] || '—';

  const dayLabel = (day: IsoDay) => {
    const long = format.dateTime(fromIsoDay(day), {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
    return day === today ? `${t('today')} · ${long}` : long;
  };

  const postRow = (p: ContentPost) => (
    <li key={p.id}>
      <button
        type="button"
        onClick={() => onOpenPost(p)}
        className="hover:bg-muted/60 flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left"
      >
        <span
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            CATEGORY_DOT_CLASS[p.category]
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {p.product || p.idea || tc(`category.${p.category}`)}
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            {[
              brands.find((b) => b.id === p.brand_id)?.name,
              tc(`format.${p.format}`),
              p.assignees.map(nameOf).join(', '),
            ]
              .filter(Boolean)
              .join(' · ')}
            {isOverdue(p, today) &&
              ` · ${format.dateTime(fromIsoDay(p.publish_date), { day: 'numeric', month: 'short' })}`}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[11px]',
            STATUS_BADGE_CLASS[p.status]
          )}
        >
          {tc(`status.${p.status}`)}
        </span>
      </button>
    </li>
  );

  const eventRow = (ev: CalendarOccurrence) => (
    <li
      key={`${ev.id}-${ev.day}`}
      className="bg-primary/5 flex items-center gap-2 rounded-md px-2 py-1.5"
    >
      {ev.kind === 'meeting' ? (
        <Video className="text-primary h-4 w-4 shrink-0" />
      ) : (
        <Star
          className={cn(
            'h-4 w-4 shrink-0',
            ev.priority === 'high' ? 'text-orange-500' : 'text-primary'
          )}
        />
      )}
      <button
        type="button"
        onClick={() => onOpenEvent(ev)}
        className="min-w-0 flex-1 truncate text-left text-sm"
      >
        {ev.start_time && (
          <span className="mr-1.5 font-semibold">{ev.start_time}</span>
        )}
        {ev.title}
      </button>
      {ev.url && ev.day === today && (
        <a
          href={ev.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ size: 'sm' }))}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('join')}
        </a>
      )}
    </li>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('summary', {
            today: pendingToday,
            week: pendingWeek,
            overdue: overdue.length,
            days: AGENDA_DAYS,
          })}
        </CardDescription>
        {currentUserId && (
          <CardAction>
            <div className="border-border flex rounded-lg border p-0.5 text-xs">
              {([false, true] as const).map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  aria-pressed={mine === value}
                  onClick={() => setMine(value)}
                  className={cn(
                    'rounded-md px-2.5 py-1 font-medium',
                    mine === value
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground'
                  )}
                >
                  {value ? t('mine') : t('everyone')}
                </button>
              ))}
            </div>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="max-h-[28rem] space-y-4 overflow-y-auto">
        {overdue.length > 0 && (
          <section>
            <h3 className="mb-1 px-2 text-xs font-semibold text-red-600 uppercase dark:text-red-400">
              {t('overdue')}
            </h3>
            <ul>{overdue.map(postRow)}</ul>
          </section>
        )}
        {days.map((day) => {
          const dayPosts = upcoming.filter((p) => p.publish_date === day);
          const dayEvents = events.filter((e) => e.day === day);
          return (
            <section key={day}>
              <h3
                className={cn(
                  'mb-1 px-2 text-xs font-semibold first-letter:uppercase',
                  day === today ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {dayLabel(day)}
              </h3>
              {dayPosts.length === 0 && dayEvents.length === 0 ? (
                <p className="text-muted-foreground px-2 text-sm">
                  {t('nothingToday')}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {dayEvents.map(eventRow)}
                  {dayPosts.map(postRow)}
                </ul>
              )}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
