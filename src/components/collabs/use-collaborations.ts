'use client';

// ============================================================
// Influencer / brand collaborations (108), kept live over Realtime
// like the calendar and collections: any change refetches.
// ============================================================

import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { IsoDay } from '@/lib/calendar/month-grid';
import {
  toCollabKind,
  toCollabPlatform,
  toCollabStatus,
  type CollabKind,
  type CollabPlatform,
  type CollabStatus,
} from '@/lib/team/work-meta';

export interface Collaboration {
  id: string;
  name: string;
  handle: string;
  platform: CollabPlatform;
  kind: CollabKind;
  status: CollabStatus;
  amount: number | null;
  products: string;
  publish_date: IsoDay | null;
  url: string | null;
  owner_id: string | null;
  notes: string;
}

export type CollaborationInput = Omit<Collaboration, 'id'>;

const COLUMNS =
  'id, name, handle, platform, kind, status, amount, products, publish_date, url, owner_id, notes';

export function useCollaborations() {
  const { accountId } = useAuth();
  const [collabs, setCollabs] = useState<Collaboration[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!accountId) return;
    try {
      const { data, error } = await createClient()
        .from('collaborations')
        .select(COLUMNS)
        .eq('account_id', accountId)
        .order('publish_date', { ascending: true, nullsFirst: false })
        .order('created_at');
      if (error) throw error;
      setCollabs(
        (data ?? []).map((r) => ({
          id: r.id as string,
          name: r.name as string,
          handle: (r.handle as string) ?? '',
          platform: toCollabPlatform(r.platform),
          kind: toCollabKind(r.kind),
          status: toCollabStatus(r.status),
          // numeric comes back as a string from PostgREST.
          amount: r.amount === null ? null : Number(r.amount),
          products: (r.products as string) ?? '',
          publish_date: (r.publish_date as string | null) ?? null,
          url: (r.url as string | null) ?? null,
          owner_id: (r.owner_id as string | null) ?? null,
          notes: (r.notes as string) ?? '',
        }))
      );
    } catch (err) {
      console.error(
        '[useCollaborations] load failed:',
        (err as { message?: string })?.message ?? err
      );
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    void reload();
  }, [accountId, reload]);

  // Unfiltered: DELETE events cannot be filtered; RLS scopes the rest.
  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`collaborations:${accountId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'collaborations' },
        () => void reload()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, reload]);

  return { loading, collabs, reload };
}

export async function saveCollaboration(
  accountId: string,
  id: string | null,
  input: CollaborationInput
): Promise<void> {
  const supabase = createClient();
  const { error } = id
    ? await supabase.from('collaborations').update(input).eq('id', id)
    : await supabase
        .from('collaborations')
        .insert({ ...input, account_id: accountId });
  if (error) throw error;
}
