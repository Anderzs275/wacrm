'use client';

// ============================================================
// Who is connected. Everyone sees the presence dot; only admins see
// when a teammate was last connected (fork rule, also applied to the
// Members tab and the inbox assign menu via `presenceLabel`).
// ============================================================

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PRESENCE_DOT_CLASS } from '@/components/presence/presence-dot';
import type { usePresence } from '@/hooks/use-presence';
import { summarize, type PresenceStatus } from '@/lib/presence';
import { TEAM_CHIP_CLASS } from '@/lib/team/colors';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import type { TeamGroup } from './use-team-space';

type Presence = ReturnType<typeof usePresence>;

const STATUS_ORDER: Record<PresenceStatus, number> = {
  online: 0,
  away: 1,
  offline: 2,
};

export function RosterCard({
  members,
  groups,
  membership,
  canSeeLastSeen,
  presence,
}: {
  members: AccountMember[];
  groups: TeamGroup[];
  membership: Map<string, Set<string>>;
  canSeeLastSeen: boolean;
  /** From the page's single usePresence(), shared with the top strip. */
  presence: Presence;
}) {
  const t = useTranslations('Team.roster');
  const tRoles = useTranslations('Settings.roles');
  const format = useFormatter();
  const { getPresence, getRow, now } = presence;
  const [filter, setFilter] = useState<string | null>(null);

  const groupsOf = (userId: string) =>
    groups.filter((g) => membership.get(g.id)?.has(userId));

  const visible = useMemo(() => {
    const inFilter = filter
      ? members.filter((m) => membership.get(filter)?.has(m.user_id))
      : members;
    return [...inFilter].sort(
      (a, b) =>
        STATUS_ORDER[getPresence(a.user_id)] -
          STATUS_ORDER[getPresence(b.user_id)] ||
        (a.full_name || '').localeCompare(b.full_name || '')
    );
  }, [filter, members, membership, getPresence]);

  const counts = summarize(visible.map((m) => getPresence(m.user_id)));

  function statusText(member: AccountMember): string {
    const status = getPresence(member.user_id);
    if (status === 'online') return t('online');
    if (status === 'away') return t('away');
    if (!canSeeLastSeen) return t('offline');
    const lastSeen = getRow(member.user_id)?.last_seen_at;
    if (!lastSeen) return t('neverConnected');
    const date = new Date(lastSeen);
    return t('lastSeen', {
      when: format.dateTime(date, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
      relative: format.relativeTime(date, now),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('summary', counts)}
          {canSeeLastSeen && (
            <span className="block text-xs">{t('adminHint')}</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              active={filter === null}
              onClick={() => setFilter(null)}
            >
              {t('all')}
            </FilterChip>
            {groups.map((g) => (
              <FilterChip
                key={g.id}
                active={filter === g.id}
                className={
                  filter === g.id ? TEAM_CHIP_CLASS[g.color] : undefined
                }
                onClick={() => setFilter(filter === g.id ? null : g.id)}
              >
                {g.name}
              </FilterChip>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {t('empty')}
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {visible.map((member) => {
              const status = getPresence(member.user_id);
              const name = member.full_name || member.email || t('unnamed');
              return (
                <li
                  key={member.user_id}
                  className="flex items-center gap-3 py-2.5"
                >
                  <div className="relative shrink-0">
                    <Avatar className="size-9">
                      {member.avatar_url ? (
                        <AvatarImage src={member.avatar_url} alt={name} />
                      ) : null}
                      <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                        {name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      aria-hidden
                      className={cn(
                        'ring-background absolute right-0 bottom-0 size-2.5 rounded-full ring-2',
                        PRESENCE_DOT_CLASS[status]
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-foreground truncate text-sm font-medium">
                        {name}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {tRoles(member.role)}
                      </span>
                      {groupsOf(member.user_id).map((g) => (
                        <span
                          key={g.id}
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[11px] leading-none font-medium',
                            TEAM_CHIP_CLASS[g.color]
                          )}
                        >
                          {g.name}
                        </span>
                      ))}
                    </div>
                    <p
                      className={cn(
                        'text-xs',
                        status === 'online'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-muted-foreground'
                      )}
                    >
                      {statusText(member)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active,
  className,
  onClick,
  children,
}: {
  active: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
        className
      )}
    >
      {children}
    </button>
  );
}
