'use client';

// ============================================================
// Thin bar at the top of the Equipo page: the next meeting day and
// who is online. "Next" is the first day from today that has a
// meeting (repeating ones included); on that day the meetings stay up,
// with their Join link, until the day is over. With no meeting coming
// up the meeting side simply isn't there. The full roster lives
// further down the page.
// ============================================================

import { useFormatter, useTranslations } from 'next-intl';
import { ExternalLink, Video } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from '@/components/ui/avatar';
import type { CalendarOccurrence } from '@/components/calendar/use-content-calendar';
import type { usePresence } from '@/hooks/use-presence';
import { fromIsoDay, type IsoDay } from '@/lib/calendar/month-grid';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';

export function TeamStrip({
  nextMeetings,
  today,
  members,
  presence,
}: {
  /** Meetings on the next day that has any (see nextMeetingDay). */
  nextMeetings: CalendarOccurrence[];
  today: IsoDay;
  members: AccountMember[];
  presence: ReturnType<typeof usePresence>;
}) {
  const t = useTranslations('Team.strip');
  const format = useFormatter();
  const online = members.filter(
    (m) => presence.getPresence(m.user_id) !== 'offline'
  );

  const dayLabel = (day: IsoDay) =>
    day === today
      ? t('today')
      : format.dateTime(fromIsoDay(day), {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        });

  return (
    <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2">
      {nextMeetings.map((m) => {
        const isToday = m.day === today;
        return (
          <div
            key={`${m.id}-${m.day}`}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-lg px-2 py-1',
              isToday ? 'bg-primary/10' : 'bg-muted/50'
            )}
          >
            <Video
              className={cn(
                'h-4 w-4 shrink-0',
                isToday ? 'text-primary' : 'text-muted-foreground'
              )}
            />
            <span className="truncate text-sm">
              <span className="font-semibold first-letter:uppercase">
                {dayLabel(m.day)}
                {m.start_time && ` ${m.start_time}`}
              </span>
              {' · '}
              {m.title}
            </span>
            {m.url && isToday && (
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ size: 'sm' }))}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('join')}
              </a>
            )}
          </div>
        );
      })}

      <div className="ml-auto flex items-center gap-2">
        <span className="text-muted-foreground text-xs">
          {t('online', { n: online.length })}
        </span>
        <AvatarGroup>
          {online.slice(0, 7).map((m) => {
            const name = m.full_name || m.email || '?';
            return (
              <div key={m.user_id} className="relative" title={name}>
                <Avatar className="size-7">
                  {m.avatar_url ? (
                    <AvatarImage src={m.avatar_url} alt={name} />
                  ) : null}
                  <AvatarFallback className="bg-primary/10 text-primary text-[11px]">
                    {name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span
                  aria-hidden
                  className={cn(
                    'ring-card absolute right-0 bottom-0 size-2 rounded-full ring-2',
                    presence.getPresence(m.user_id) === 'online'
                      ? 'bg-emerald-500'
                      : 'bg-amber-500'
                  )}
                />
              </div>
            );
          })}
        </AvatarGroup>
      </div>
    </div>
  );
}
