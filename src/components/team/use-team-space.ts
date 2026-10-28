'use client';

// ============================================================
// Data for the Equipo page: members, team labels and memberships,
// kept live over Realtime. (Meetings moved to the calendar, see
// 105_calendar_event_repeat.sql.)
//
// Members come from GET /api/account/members (which already hides
// emails from non-admins); the team tables are read straight
// through the browser client under RLS (101_team_space.sql). Any
// change to a team table simply refetches that table — the lists are
// a handful of rows for a 7-person team, so a refetch is cheaper to
// reason about than patching state from Realtime payloads.
// ============================================================

import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toTeamColor, type TeamColor } from '@/lib/team/colors';
import type { AccountMember } from '@/types';

export interface TeamGroup {
  id: string;
  name: string;
  color: TeamColor;
}

export interface TeamSpace {
  loading: boolean;
  members: AccountMember[];
  groups: TeamGroup[];
  /** group id → member user ids */
  membership: Map<string, Set<string>>;
  reloadGroups: () => Promise<void>;
}

export function useTeamSpace(): TeamSpace {
  const { accountId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [membership, setMembership] = useState<Map<string, Set<string>>>(
    () => new Map()
  );

  const reloadMembers = useCallback(async () => {
    const res = await fetch('/api/account/members', { cache: 'no-store' });
    if (!res.ok) throw new Error(`members ${res.status}`);
    const data = (await res.json()) as { members: AccountMember[] };
    setMembers(data.members);
  }, []);

  const reloadGroups = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const [g, m] = await Promise.all([
      supabase
        .from('team_groups')
        .select('id, name, color')
        .eq('account_id', accountId)
        .order('name'),
      supabase.from('team_group_members').select('group_id, user_id'),
    ]);
    if (g.error) throw g.error;
    if (m.error) throw m.error;
    setGroups(
      (g.data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        color: toTeamColor(row.color),
      }))
    );
    const next = new Map<string, Set<string>>();
    for (const row of m.data ?? []) {
      const groupId = row.group_id as string;
      if (!next.has(groupId)) next.set(groupId, new Set());
      next.get(groupId)!.add(row.user_id as string);
    }
    setMembership(next);
  }, [accountId]);

  const loadAll = useCallback(async () => {
    const results = await Promise.allSettled([reloadMembers(), reloadGroups()]);
    for (const r of results) {
      // Supabase errors log as `{}` when passed as an object.
      if (r.status === 'rejected') {
        console.error(
          '[useTeamSpace] load failed:',
          (r.reason as Error)?.message ?? r.reason
        );
      }
    }
    setLoading(false);
  }, [reloadMembers, reloadGroups]);

  useEffect(() => {
    if (!accountId) return;
    // Every setState in loadAll runs after an await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll();
  }, [accountId, loadAll]);

  useEffect(() => {
    if (!accountId) return;
    const log = (what: string) => (err: unknown) =>
      console.error(`[useTeamSpace] ${what} failed:`, err);

    // Unfiltered on purpose: Realtime cannot filter DELETE events, so
    // an `account_id` filter would hide a teammate deleting a team.
    // RLS still limits inserts/updates to this account, and the
    // handlers only refetch, so a stray event costs one small query.
    const supabase = createClient();
    const channel = supabase
      .channel(`team-space:${accountId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_groups' },
        () => void reloadGroups().catch(log('groups'))
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_group_members' },
        () => void reloadGroups().catch(log('groups'))
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, reloadGroups]);

  return { loading, members, groups, membership, reloadGroups };
}
