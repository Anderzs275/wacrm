'use client';

// ============================================================
// Content calendar: month grid (default) or a grouped working list
// (list-view.tsx). Each day of the grid also shows Peruvian holidays
// and retail dates, and the team's meetings and key dates. Clicking a
// post or event edits it; clicking a day's empty space plans a post
// there.
// ============================================================

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Flag,
  Handshake,
  List,
  Plus,
  Repeat,
  Rocket,
  Star,
  Tag,
  Video,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CATEGORY_CHIP_CLASS,
  CONTENT_STATUSES,
  isOverdue,
  type ContentStatus,
} from '@/lib/calendar/content-meta';
import {
  fromIsoDay,
  gridRange,
  monthGrid,
  type IsoDay,
} from '@/lib/calendar/month-grid';
import { peruDatesBetween, type PeruDate } from '@/lib/calendar/peru-dates';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import { BoardView } from './board-view';
import { ListView } from './list-view';
import type {
  CalendarOccurrence,
  ContentBrand,
  ContentPost,
} from './use-content-calendar';

/**
 * A date that belongs to another tab but is worth seeing on the
 * calendar: a collection launch or a collab going live.
 */
export interface CalendarMilestone {
  id: string;
  kind: 'launch' | 'collab';
  title: string;
  day: IsoDay;
}

const ALL = 'all';
const MAX_CHIPS = 3;

export function CalendarCard({
  month,
  onMonthChange,
  today,
  posts,
  events,
  members,
  brands,
  onOpenPost,
  onNewPost,
  onOpenEvent,
  onNewEvent,
  canDelete,
  onChanged,
  milestones,
  onOpenMilestone,
}: {
  month: IsoDay;
  onMonthChange: (delta: number | 'today') => void;
  today: IsoDay;
  posts: ContentPost[];
  events: CalendarOccurrence[];
  members: AccountMember[];
  brands: ContentBrand[];
  onOpenPost: (post: ContentPost) => void;
  onNewPost: (day: IsoDay, status?: ContentStatus) => void;
  onOpenEvent: (event: CalendarOccurrence) => void;
  onNewEvent: (day: IsoDay) => void;
  /** Admin: the list's row menu offers Delete. */
  canDelete: boolean;
  /** After an inline change in the list (status, duplicate, delete). */
  onChanged: () => void;
  milestones: CalendarMilestone[];
  onOpenMilestone: (milestone: CalendarMilestone) => void;
}) {
  const t = useTranslations('Calendar');
  const format = useFormatter();
  const [view, setView] = useState<'month' | 'list' | 'board'>('month');
  const [brand, setBrand] = useState(ALL);
  const [assignee, setAssignee] = useState(ALL);
  const [status, setStatus] = useState(ALL);

  const filtered = useMemo(
    () =>
      posts.filter(
        (p) =>
          (brand === ALL || p.brand_id === brand) &&
          (assignee === ALL || p.assignees.includes(assignee)) &&
          (status === ALL || p.status === status)
      ),
    [posts, brand, assignee, status]
  );

  const byDay = useMemo(() => {
    const map = new Map<IsoDay, ContentPost[]>();
    for (const p of filtered) {
      const list = map.get(p.publish_date) ?? [];
      list.push(p);
      map.set(p.publish_date, list);
    }
    return map;
  }, [filtered]);

  const eventsByDay = useMemo(() => groupBy(events, (e) => e.day), [events]);
  const milestonesByDay = useMemo(
    () => groupBy(milestones, (m) => m.day),
    [milestones]
  );
  const peruByDay = useMemo(() => {
    const { from, to } = gridRange(month);
    return groupBy(peruDatesBetween(from, to), (d) => d.day);
  }, [month]);
  const defaultDay = today.slice(0, 7) === month.slice(0, 7) ? today : month;

  const weeks = monthGrid(month);
  const monthLabel = format.dateTime(fromIsoDay(month), {
    month: 'long',
    year: 'numeric',
  });
  const weekdayLabels = weeks[0].map(({ day }) =>
    format.dateTime(fromIsoDay(day), { weekday: 'short' })
  );
  const titleOf = (p: ContentPost) =>
    p.product || p.idea || t(`category.${p.category}`);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2 space-y-0">
        <CardTitle className="mr-2 first-letter:uppercase">
          {monthLabel}
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={t('prevMonth')}
            onClick={() => onMonthChange(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onMonthChange('today')}
          >
            {t('today')}
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={t('nextMonth')}
            onClick={() => onMonthChange(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="border-border ml-1 flex rounded-lg border p-0.5">
          {(['month', 'list', 'board'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium',
                view === v
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {v === 'month' ? (
                <CalendarDays className="h-3.5 w-3.5" />
              ) : v === 'list' ? (
                <List className="h-3.5 w-3.5" />
              ) : (
                <Columns3 className="h-3.5 w-3.5" />
              )}
              {t(`view.${v}`)}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterSelect
            value={brand}
            onChange={setBrand}
            allLabel={t('filters.allBrands')}
            options={brands.map((b) => ({ value: b.id, label: b.name }))}
          />
          <FilterSelect
            value={assignee}
            onChange={setAssignee}
            allLabel={t('filters.allPeople')}
            options={members.map((m) => ({
              value: m.user_id,
              label: m.full_name || m.email || '—',
            }))}
          />
          <FilterSelect
            value={status}
            onChange={setStatus}
            allLabel={t('filters.allStatuses')}
            options={CONTENT_STATUSES.map((s) => ({
              value: s,
              label: t(`status.${s}`),
            }))}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => onNewEvent(defaultDay)}
          >
            <Video className="h-4 w-4" />
            {t('newMeeting')}
          </Button>
          <Button size="sm" onClick={() => onNewPost(defaultDay)}>
            <Plus className="h-4 w-4" />
            {t('new')}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {view === 'month' ? (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="text-muted-foreground grid grid-cols-7 pb-1 text-center text-xs font-medium capitalize">
                {weekdayLabels.map((label) => (
                  <div key={label}>{label}</div>
                ))}
              </div>
              <div className="border-border bg-border grid grid-cols-7 gap-px overflow-hidden rounded-lg border">
                {weeks.flat().map(({ day, inMonth: isCurrent }) => {
                  const dayPosts = byDay.get(day) ?? [];
                  const extra = dayPosts.length - MAX_CHIPS;
                  const peru = peruByDay.get(day) ?? [];
                  const isHoliday = peru.some((d) => d.kind === 'holiday');
                  const weekday = fromIsoDay(day).getDay();
                  const isWeekend = weekday === 0 || weekday === 6;
                  const isToday = day === today;
                  return (
                    <div
                      key={day}
                      role="button"
                      tabIndex={0}
                      aria-label={t('newOn', {
                        day: format.dateTime(fromIsoDay(day), {
                          day: 'numeric',
                          month: 'long',
                        }),
                      })}
                      onClick={() => onNewPost(day)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onNewPost(day);
                      }}
                      className={cn(
                        'group flex min-h-28 cursor-pointer flex-col gap-1 p-1.5 text-left transition-colors',
                        // Days outside the month recede instead of standing out.
                        // Only the day number dims, so its labels stay legible.
                        !isCurrent
                          ? 'bg-muted/10 hover:bg-muted/30'
                          : isWeekend
                            ? 'bg-muted/20 hover:bg-muted/40'
                            : 'bg-card hover:bg-muted/40',
                        isToday &&
                          'ring-primary bg-primary/[0.06] ring-2 ring-inset'
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-7 items-center justify-center rounded-full text-sm font-semibold',
                          isToday
                            ? 'bg-primary text-primary-foreground'
                            : !isCurrent
                              ? 'text-muted-foreground/60'
                              : isHoliday
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-foreground'
                        )}
                      >
                        {fromIsoDay(day).getDate()}
                      </span>
                      {peru.map((d) => (
                        <PeruLabel key={d.key} date={d} />
                      ))}
                      {(milestonesByDay.get(day) ?? []).map((m) => (
                        <button
                          key={`${m.kind}-${m.id}`}
                          type="button"
                          title={m.title}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenMilestone(m);
                          }}
                          className={cn(
                            'flex h-6 shrink-0 items-center gap-1 truncate rounded px-1.5 text-left text-xs font-semibold',
                            m.kind === 'launch'
                              ? 'bg-orange-500 text-white'
                              : 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200'
                          )}
                        >
                          {m.kind === 'launch' ? (
                            <Rocket className="h-3 w-3 shrink-0" />
                          ) : (
                            <Handshake className="h-3 w-3 shrink-0" />
                          )}
                          <span className="truncate">{m.title}</span>
                        </button>
                      ))}
                      {(eventsByDay.get(day) ?? []).map((ev) => (
                        <EventChip
                          key={`${ev.id}-${ev.day}`}
                          event={ev}
                          onOpen={() => onOpenEvent(ev)}
                        />
                      ))}
                      {dayPosts.slice(0, MAX_CHIPS).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          title={`${t(`category.${p.category}`)} · ${titleOf(p)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenPost(p);
                          }}
                          className={cn(
                            'text-foreground flex items-center gap-1.5 truncate rounded-md border-l-[3px] px-1.5 py-1 text-left text-xs leading-tight font-medium',
                            CATEGORY_CHIP_CLASS[p.category],
                            p.status === 'published' && 'opacity-60',
                            isOverdue(p, today) && 'ring-1 ring-red-500'
                          )}
                        >
                          <StatusMark status={p.status} />
                          <span className="truncate">{titleOf(p)}</span>
                        </button>
                      ))}
                      {extra > 0 && (
                        <span className="text-muted-foreground px-1 text-[11px]">
                          {t('more', { n: extra })}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-red-500" />
                  {t('legend.holiday')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-indigo-500" />
                  {t('legend.commercial')}
                </span>
                <span className="flex items-center gap-1.5">
                  <Video className="text-primary h-3 w-3" />
                  {t('legend.meeting')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded-sm bg-orange-500" />
                  {t('legend.high')}
                </span>
                <span className="flex items-center gap-1.5">
                  <Rocket className="h-3 w-3 text-orange-500" />
                  {t('legend.launch')}
                </span>
                <span className="flex items-center gap-1.5">
                  <Handshake className="h-3 w-3 text-emerald-500" />
                  {t('legend.collab')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full ring-1 ring-red-500" />
                  {t('legend.overdue')}
                </span>
              </div>
            </div>
          </div>
        ) : view === 'list' ? (
          <ListView
            month={month}
            today={today}
            posts={filtered}
            brands={brands}
            members={members}
            canDelete={canDelete}
            onOpenPost={onOpenPost}
            onNewPost={onNewPost}
            onChanged={onChanged}
          />
        ) : (
          <BoardView
            month={month}
            today={today}
            posts={filtered}
            brands={brands}
            members={members}
            onOpenPost={onOpenPost}
            onNewPost={onNewPost}
            onChanged={onChanged}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function StatusMark({ status }: { status: ContentStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        status === 'published' && 'bg-emerald-500',
        status === 'review' && 'bg-amber-500',
        status === 'in_progress' && 'bg-sky-500',
        status === 'pending' && 'border-muted-foreground border'
      )}
    />
  );
}

function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
}) {
  const current = options.find((o) => o.value === value)?.label ?? allLabel;
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? ALL)}>
      <SelectTrigger size="sm" className="w-44">
        <SelectValue>{current}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A holiday or retail date. The text keeps the normal foreground
 * colour; only the icon and a left edge carry the meaning, because
 * coloured text on a tint of the same colour was unreadable in dark
 * mode.
 */
function PeruLabel({ date }: { date: PeruDate }) {
  const t = useTranslations('Calendar.peru');
  const holiday = date.kind === 'holiday';
  return (
    <span
      title={t(date.key)}
      className={cn(
        'bg-muted text-foreground flex items-center gap-1 truncate rounded border-l-[3px] px-1.5 py-0.5 text-[11px] leading-tight font-medium',
        holiday ? 'border-l-red-500' : 'border-l-indigo-400'
      )}
    >
      {holiday ? (
        <Flag className="h-3 w-3 shrink-0 text-red-500" />
      ) : (
        <Tag className="h-3 w-3 shrink-0 text-indigo-400" />
      )}
      <span className="truncate">{t(date.key)}</span>
    </span>
  );
}

function groupBy<T>(
  items: readonly T[],
  key: (item: T) => string
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

/**
 * One day of an event. A multi-day span is drawn as a continuous bar:
 * square edges where it carries on into the next or previous day, the
 * title only where a reader starts looking (its first day and each
 * Monday). High priority is a solid fill so campaigns stand out.
 */
function EventChip({
  event: ev,
  onOpen,
}: {
  event: CalendarOccurrence;
  onOpen: () => void;
}) {
  const isSpan = !!ev.end_date && ev.end_date !== ev.event_date;
  const isStart = ev.day === ev.event_date;
  const isEnd = ev.day === (ev.end_date ?? ev.event_date);
  const showTitle = !isSpan || isStart || fromIsoDay(ev.day).getDay() === 1;
  const high = ev.priority === 'high';
  return (
    <button
      type="button"
      title={[ev.start_time, ev.title].filter(Boolean).join(' · ')}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={cn(
        'flex h-6 shrink-0 items-center gap-1 truncate px-1.5 text-left text-xs leading-tight font-medium',
        high
          ? 'bg-orange-500 text-white'
          : ev.kind === 'meeting'
            ? 'bg-primary/10 text-primary'
            : 'bg-violet-500/20 text-violet-800 dark:text-violet-200',
        isSpan ? cn(!isStart && '-ml-1.5', !isEnd && '-mr-1.5') : 'rounded',
        isSpan && isStart && 'rounded-l',
        isSpan && isEnd && 'rounded-r'
      )}
    >
      {showTitle && (
        <>
          {ev.kind === 'meeting' ? (
            <Video className="h-3 w-3 shrink-0" />
          ) : (
            <Star className="h-3 w-3 shrink-0" />
          )}
          {ev.start_time && !isSpan && (
            <span className="shrink-0">{ev.start_time}</span>
          )}
          <span className="truncate">{ev.title}</span>
          {ev.repeat !== 'none' && (
            <Repeat className="h-2.5 w-2.5 shrink-0 opacity-70" />
          )}
        </>
      )}
    </button>
  );
}
