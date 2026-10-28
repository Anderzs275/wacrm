'use client';

// ============================================================
// Content calendar data (104_content_calendar.sql), kept live over
// Realtime the same way useTeamSpace is: any change refetches.
//
// Reads: posts and events drawn in the visible month grid (repeating
// events expanded into their days, see recurrence.ts); the agenda
// (anything overdue, which can sit in an earlier month, plus the posts
// and events from today through the next AGENDA_DAYS); and the brands.
// Assignees are a second query by post id rather than an embedded
// select, so a stale PostgREST schema cache right after the migration
// cannot break the page (see getCurrentAccount).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { addDays } from 'date-fns';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  toCategory,
  toFormat,
  toStatus,
  type ContentCategory,
  type ContentFormat,
  type ContentStatus,
} from '@/lib/calendar/content-meta';
import {
  fromIsoDay,
  gridRange,
  toIsoDay,
  type IsoDay,
} from '@/lib/calendar/month-grid';
import { nextMeetingDay } from '@/lib/calendar/next-meeting';
import {
  occurrencesBetween,
  toRepeatRule,
  type RepeatRule,
} from '@/lib/calendar/recurrence';

export interface ContentBrand {
  id: string;
  name: string;
}

export interface ContentPost {
  id: string;
  publish_date: IsoDay;
  category: ContentCategory;
  brand_id: string | null;
  format: ContentFormat;
  product: string;
  idea: string;
  caption: string;
  status: ContentStatus;
  updated_by: string | null;
  updated_at: string;
  assignees: string[];
}

export type ContentPostInput = Omit<
  ContentPost,
  'id' | 'updated_by' | 'updated_at'
>;

export type CalendarEventKind = 'meeting' | 'key_date';

export interface CalendarEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  event_date: IsoDay;
  /** 'HH:MM', Lima wall-clock time; null for all-day. */
  start_time: string | null;
  end_time: string | null;
  url: string | null;
  notes: string;
  /** Series rule (105); `event_date` is the first day. */
  repeat: RepeatRule;
  repeat_until: IsoDay | null;
  /** Last day of a multi-day span (106), inclusive; null = one day. */
  end_date: IsoDay | null;
  priority: 'normal' | 'high';
  created_by: string | null;
}

export type CalendarEventInput = Omit<CalendarEvent, 'id' | 'created_by'>;

/** One day a (possibly repeating) event falls on. */
export interface CalendarOccurrence extends CalendarEvent {
  day: IsoDay;
}

const POST_COLUMNS =
  'id, publish_date, category, brand_id, format, product, idea, caption, status, updated_by, updated_at';
const EVENT_COLUMNS =
  'id, kind, title, event_date, end_date, start_time, end_time, url, notes, repeat, repeat_until, priority, created_by';

type Row = Record<string, unknown>;

/** Postgres TIME comes back as 'HH:MM:SS'; the UI works in 'HH:MM'. */
const hhmm = (value: unknown) =>
  typeof value === 'string' ? value.slice(0, 5) : null;

function toEvent(r: Row): CalendarEvent {
  return {
    id: r.id as string,
    kind: r.kind === 'key_date' ? 'key_date' : 'meeting',
    title: r.title as string,
    event_date: r.event_date as string,
    start_time: hhmm(r.start_time),
    end_time: hhmm(r.end_time),
    url: (r.url as string | null) ?? null,
    notes: (r.notes as string) ?? '',
    repeat: toRepeatRule(r.repeat),
    repeat_until: (r.repeat_until as string | null) ?? null,
    end_date: (r.end_date as string | null) ?? null,
    priority: r.priority === 'high' ? 'high' : 'normal',
    created_by: (r.created_by as string | null) ?? null,
  };
}

/** Expand each series into its days within [from, to], sorted. */
function expand(
  events: CalendarEvent[],
  from: IsoDay,
  to: IsoDay
): CalendarOccurrence[] {
  return sortOccurrences(
    events.flatMap((e) =>
      occurrencesBetween(e, from, to).map((day) => ({ ...e, day }))
    )
  );
}

/**
 * By day; within a day multi-day spans first (longest first, so their
 * bars line up across the week), then high priority, then by time.
 */
export function sortOccurrences(
  events: CalendarOccurrence[]
): CalendarOccurrence[] {
  const span = (e: CalendarEvent) =>
    e.end_date
      ? fromIsoDay(e.end_date).getTime() - fromIsoDay(e.event_date).getTime()
      : 0;
  return [...events].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      span(b) - span(a) ||
      Number(b.priority === 'high') - Number(a.priority === 'high') ||
      (a.start_time ?? '99').localeCompare(b.start_time ?? '99') ||
      a.title.localeCompare(b.title)
  );
}

async function withAssignees(rows: Row[]): Promise<ContentPost[]> {
  const ids = rows.map((r) => r.id as string);
  const byPost = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data, error } = await createClient()
      .from('content_post_assignees')
      .select('post_id, user_id')
      .in('post_id', ids);
    if (error) throw error;
    for (const a of data ?? []) {
      const list = byPost.get(a.post_id as string) ?? [];
      list.push(a.user_id as string);
      byPost.set(a.post_id as string, list);
    }
  }
  return rows.map((r) => ({
    id: r.id as string,
    publish_date: r.publish_date as string,
    category: toCategory(r.category),
    brand_id: (r.brand_id as string | null) ?? null,
    format: toFormat(r.format),
    product: (r.product as string) ?? '',
    idea: (r.idea as string) ?? '',
    caption: (r.caption as string) ?? '',
    status: toStatus(r.status),
    updated_by: (r.updated_by as string | null) ?? null,
    updated_at: r.updated_at as string,
    assignees: byPost.get(r.id as string) ?? [],
  }));
}

/** How far ahead the "Hoy y próximos días" card looks. */
export const AGENDA_DAYS = 7;

/** How far ahead the top strip searches for the next meeting. */
const NEXT_MEETING_DAYS = 90;

export function useContentCalendar(month: IsoDay, today: IsoDay) {
  const { accountId } = useAuth();
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [events, setEvents] = useState<CalendarOccurrence[]>([]);
  const [agendaPosts, setAgendaPosts] = useState<ContentPost[]>([]);
  const [agendaEvents, setAgendaEvents] = useState<CalendarOccurrence[]>([]);
  const [nextMeetings, setNextMeetings] = useState<CalendarOccurrence[]>([]);
  const [brands, setBrands] = useState<ContentBrand[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { from, to } = gridRange(month);
    const agendaEnd = toIsoDay(addDays(fromIsoDay(today), AGENDA_DAYS));
    const meetingsEnd = toIsoDay(addDays(fromIsoDay(today), NEXT_MEETING_DAYS));
    try {
      // Series that started earlier still fall in range unless they ended.
      const eventsFrom = (day: IsoDay) =>
        `and(repeat.eq.none,or(event_date.gte.${day},end_date.gte.${day})),and(repeat.neq.none,or(repeat_until.is.null,repeat_until.gte.${day}))`;
      const [grid, due, gridEvents, dayEvents, meetingRows, brandRows] =
        await Promise.all([
          supabase
            .from('content_posts')
            .select(POST_COLUMNS)
            .eq('account_id', accountId)
            .gte('publish_date', from)
            .lte('publish_date', to)
            .order('publish_date')
            .order('created_at'),
          supabase
            .from('content_posts')
            .select(POST_COLUMNS)
            .eq('account_id', accountId)
            .or(
              `and(publish_date.gte.${today},publish_date.lte.${agendaEnd}),and(publish_date.lt.${today},status.neq.published)`
            )
            .order('publish_date')
            .limit(200),
          supabase
            .from('calendar_events')
            .select(EVENT_COLUMNS)
            .eq('account_id', accountId)
            .lte('event_date', to)
            .or(eventsFrom(from)),
          supabase
            .from('calendar_events')
            .select(EVENT_COLUMNS)
            .eq('account_id', accountId)
            .lte('event_date', agendaEnd)
            .or(eventsFrom(today)),
          supabase
            .from('calendar_events')
            .select(EVENT_COLUMNS)
            .eq('account_id', accountId)
            .eq('kind', 'meeting')
            .lte('event_date', meetingsEnd)
            .or(eventsFrom(today)),
          supabase
            .from('content_brands')
            .select('id, name')
            .eq('account_id', accountId)
            .order('name'),
        ]);
      for (const r of [
        grid,
        due,
        gridEvents,
        dayEvents,
        meetingRows,
        brandRows,
      ]) {
        if (r.error) throw r.error;
      }
      const [gridPosts, duePosts] = await Promise.all([
        withAssignees(grid.data ?? []),
        withAssignees(due.data ?? []),
      ]);
      setPosts(gridPosts);
      setAgendaPosts(duePosts);
      setEvents(expand((gridEvents.data ?? []).map(toEvent), from, to));
      setAgendaEvents(
        expand((dayEvents.data ?? []).map(toEvent), today, agendaEnd)
      );
      setNextMeetings(
        nextMeetingDay(
          expand((meetingRows.data ?? []).map(toEvent), today, meetingsEnd),
          today
        )
      );
      setBrands((brandRows.data ?? []) as ContentBrand[]);
    } catch (err) {
      console.error(
        '[useContentCalendar] load failed:',
        (err as Error)?.message ?? err
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, month, today]);

  useEffect(() => {
    if (!accountId) return;
    void reload();
  }, [accountId, reload]);

  // Unfiltered for the same reason as useTeamSpace: DELETE events
  // cannot be filtered, and RLS scopes the rest.
  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let channel = supabase.channel(`content-calendar:${accountId}`);
    for (const table of [
      'content_posts',
      'content_post_assignees',
      'calendar_events',
      'content_brands',
    ]) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          void reload();
        }
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, reload]);

  return {
    loading,
    posts,
    events,
    agendaPosts,
    agendaEvents,
    nextMeetings,
    brands,
    reload,
  };
}

/** Insert or update a post and make its assignees match `input.assignees`. */
export async function saveContentPost(
  accountId: string,
  id: string | null,
  input: ContentPostInput,
  previousAssignees: string[]
): Promise<void> {
  const supabase = createClient();
  const { assignees, ...values } = input;
  let postId = id;
  if (postId) {
    const { error } = await supabase
      .from('content_posts')
      .update(values)
      .eq('id', postId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from('content_posts')
      .insert({ ...values, account_id: accountId })
      .select('id')
      .single();
    if (error) throw error;
    postId = data.id as string;
  }

  const before = new Set(previousAssignees);
  const after = new Set(assignees);
  const added = [...after].filter((u) => !before.has(u));
  const removed = [...before].filter((u) => !after.has(u));
  if (added.length > 0) {
    const { error } = await supabase
      .from('content_post_assignees')
      .insert(added.map((user_id) => ({ post_id: postId, user_id })));
    if (error) throw error;
  }
  if (removed.length > 0) {
    const { error } = await supabase
      .from('content_post_assignees')
      .delete()
      .eq('post_id', postId)
      .in('user_id', removed);
    if (error) throw error;
  }
}

export async function saveCalendarEvent(
  accountId: string,
  id: string | null,
  input: CalendarEventInput
): Promise<void> {
  const supabase = createClient();
  const { error } = id
    ? await supabase.from('calendar_events').update(input).eq('id', id)
    : await supabase
        .from('calendar_events')
        .insert({ ...input, account_id: accountId });
  if (error) throw error;
}

/** Admin-only (RLS). Returns the new brand so the form can select it. */
export async function createBrand(
  accountId: string,
  name: string
): Promise<ContentBrand> {
  const { data, error } = await createClient()
    .from('content_brands')
    .insert({ account_id: accountId, name: name.trim() })
    .select('id, name')
    .single();
  if (error) throw error;
  return data as ContentBrand;
}
