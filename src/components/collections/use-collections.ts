'use client';

// ============================================================
// Collections and their task checklists (108), kept live over
// Realtime like the calendar: any change refetches. Tasks are a second
// query by collection id rather than an embedded select, for the same
// schema-cache reason as useContentCalendar.
// ============================================================

import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { IsoDay } from '@/lib/calendar/month-grid';
import { toCollectionStage, type CollectionStage } from '@/lib/team/work-meta';

export interface CollectionTask {
  id: string;
  collection_id: string;
  title: string;
  done: boolean;
  due_date: IsoDay | null;
  assignee_id: string | null;
  position: number;
}

export interface Collection {
  id: string;
  name: string;
  brand_id: string | null;
  launch_date: IsoDay | null;
  stage: CollectionStage;
  owner_id: string | null;
  notes: string;
  tasks: CollectionTask[];
}

export type CollectionInput = Omit<Collection, 'id' | 'tasks'>;

const COLUMNS = 'id, name, brand_id, launch_date, stage, owner_id, notes';
const TASK_COLUMNS =
  'id, collection_id, title, done, due_date, assignee_id, position';

export function useCollections() {
  const { accountId } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    try {
      const { data, error } = await supabase
        .from('collections')
        .select(COLUMNS)
        .eq('account_id', accountId)
        .order('launch_date', { ascending: true, nullsFirst: false })
        .order('created_at');
      if (error) throw error;
      const rows = data ?? [];
      const ids = rows.map((r) => r.id as string);
      const byCollection = new Map<string, CollectionTask[]>();
      if (ids.length > 0) {
        const tasks = await supabase
          .from('collection_tasks')
          .select(TASK_COLUMNS)
          .in('collection_id', ids)
          .order('position')
          .order('created_at');
        if (tasks.error) throw tasks.error;
        for (const task of (tasks.data ?? []) as CollectionTask[]) {
          const list = byCollection.get(task.collection_id) ?? [];
          list.push(task);
          byCollection.set(task.collection_id, list);
        }
      }
      setCollections(
        rows.map((r) => ({
          id: r.id as string,
          name: r.name as string,
          brand_id: (r.brand_id as string | null) ?? null,
          launch_date: (r.launch_date as string | null) ?? null,
          stage: toCollectionStage(r.stage),
          owner_id: (r.owner_id as string | null) ?? null,
          notes: (r.notes as string) ?? '',
          tasks: byCollection.get(r.id as string) ?? [],
        }))
      );
    } catch (err) {
      console.error(
        '[useCollections] load failed:',
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
      .channel(`collections:${accountId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'collections' },
        () => void reload()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'collection_tasks' },
        () => void reload()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, reload]);

  return { loading, collections, reload };
}

/** Insert or update; returns the collection id (new or existing). */
export async function saveCollection(
  accountId: string,
  id: string | null,
  input: CollectionInput
): Promise<string> {
  const supabase = createClient();
  if (id) {
    const { error } = await supabase
      .from('collections')
      .update(input)
      .eq('id', id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase
    .from('collections')
    .insert({ ...input, account_id: accountId })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}
