'use client';

// ============================================================
// Create / edit a collection launch, with its task checklist.
//
// The checklist edits apply immediately (tick, add, remove), so two
// people working on the same launch see each other's changes live.
// A new collection is saved first and the dialog stays open on it, so
// tasks can be added straight away; an empty checklist offers the
// usual launch steps as a starting point.
// ============================================================

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ListChecks, Loader2, Plus, Trash2, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import {
  COLLECTION_STAGES,
  progressOf,
  type CollectionStage,
} from '@/lib/team/work-meta';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import type { ContentBrand } from '@/components/calendar/use-content-calendar';
import {
  saveCollection,
  type Collection,
  type CollectionInput,
  type CollectionTask,
} from './use-collections';

const NONE = 'none';

/** Translation keys of the suggested launch checklist, in order. */
const SUGGESTED_TASKS = [
  'design',
  'fabric',
  'samples',
  'production',
  'photoshoot',
  'web',
  'content',
  'launch',
] as const;

export interface CollectionDraft extends CollectionInput {
  id: string | null;
}

export function newCollectionDraft(
  stage: CollectionStage = 'idea'
): CollectionDraft {
  return {
    id: null,
    name: '',
    brand_id: null,
    launch_date: null,
    stage,
    owner_id: null,
    notes: '',
  };
}

export function collectionDraftFrom(c: Collection): CollectionDraft {
  return {
    id: c.id,
    name: c.name,
    brand_id: c.brand_id,
    launch_date: c.launch_date,
    stage: c.stage,
    owner_id: c.owner_id,
    notes: c.notes,
  };
}

export function CollectionDialog({
  draft,
  collections,
  brands,
  members,
  canDelete,
  onClose,
  onChanged,
}: {
  draft: CollectionDraft | null;
  /** Live list, so the checklist reflects Realtime changes. */
  collections: Collection[];
  brands: ContentBrand[];
  members: AccountMember[];
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-popover border-border max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {draft && (
          <CollectionForm
            key={draft.id ?? 'new'}
            initial={draft}
            collections={collections}
            brands={brands}
            members={members}
            canDelete={canDelete}
            onClose={onClose}
            onChanged={onChanged}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CollectionForm({
  initial,
  collections,
  brands,
  members,
  canDelete,
  onClose,
  onChanged,
}: {
  initial: CollectionDraft;
  collections: Collection[];
  brands: ContentBrand[];
  members: AccountMember[];
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('Collections');
  const { accountId } = useAuth();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newTask, setNewTask] = useState('');

  const set = <K extends keyof CollectionDraft>(
    key: K,
    value: CollectionDraft[K]
  ) => setDraft((d) => ({ ...d, [key]: value }));

  const tasks: CollectionTask[] =
    collections.find((c) => c.id === draft.id)?.tasks ?? [];
  const progress = progressOf(tasks);
  const nameOf = (id: string | null) =>
    members.find((m) => m.user_id === id)?.full_name ?? '';

  const fail = (err: unknown) =>
    toast.error(t('saveFailed'), {
      description: (err as { message?: string })?.message,
    });

  async function handleSave(close: boolean) {
    if (!accountId) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error(t('nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const { id, ...input } = draft;
      const savedId = await saveCollection(accountId, id, {
        ...input,
        name,
        notes: input.notes.trim(),
      });
      onChanged();
      if (close) {
        toast.success(t('saved'));
        onClose();
      } else {
        // A new collection stays open so its checklist can be filled.
        set('id', savedId);
        toast.success(t('createdAddTasks'));
      }
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  }

  async function addTasks(titles: string[]) {
    if (!draft.id || titles.length === 0) return;
    const start = tasks.length;
    const { error } = await createClient()
      .from('collection_tasks')
      .insert(
        titles.map((title, i) => ({
          collection_id: draft.id,
          title,
          position: start + i,
        }))
      );
    if (error) fail(error);
    else onChanged();
  }

  async function updateTask(
    task: CollectionTask,
    patch: Partial<CollectionTask>
  ) {
    const { error } = await createClient()
      .from('collection_tasks')
      .update(patch)
      .eq('id', task.id);
    if (error) fail(error);
    else onChanged();
  }

  async function removeTask(task: CollectionTask) {
    const { error } = await createClient()
      .from('collection_tasks')
      .delete()
      .eq('id', task.id);
    if (error) fail(error);
    else onChanged();
  }

  async function handleDelete() {
    if (!draft.id) return;
    setSaving(true);
    const { error } = await createClient()
      .from('collections')
      .delete()
      .eq('id', draft.id);
    setSaving(false);
    if (error) {
      fail(error);
      return;
    }
    onChanged();
    onClose();
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave(true);
      }}
    >
      <DialogHeader>
        <DialogTitle>{draft.id ? t('editTitle') : t('newTitle')}</DialogTitle>
        <DialogDescription>{t('dialogDescription')}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="collection-name">{t('fields.name')}</Label>
          <Input
            id="collection-name"
            value={draft.name}
            maxLength={120}
            placeholder={t('fields.namePlaceholder')}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('fields.brand')}</Label>
          <Select
            value={draft.brand_id ?? NONE}
            onValueChange={(v) => set('brand_id', !v || v === NONE ? null : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {brands.find((b) => b.id === draft.brand_id)?.name ??
                  t('fields.noBrand')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('fields.noBrand')}</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="collection-launch">{t('fields.launchDate')}</Label>
          <Input
            id="collection-launch"
            type="date"
            value={draft.launch_date ?? ''}
            onChange={(e) => set('launch_date', e.target.value || null)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('fields.stage')}</Label>
          <Select
            value={draft.stage}
            onValueChange={(v) => v && set('stage', v as CollectionStage)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{t(`stage.${draft.stage}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COLLECTION_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`stage.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t('fields.owner')}</Label>
          <Select
            value={draft.owner_id ?? NONE}
            onValueChange={(v) => set('owner_id', !v || v === NONE ? null : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {nameOf(draft.owner_id) || t('fields.nobody')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('fields.nobody')}</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.full_name || m.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="collection-notes">{t('fields.notes')}</Label>
          <Textarea
            id="collection-notes"
            rows={2}
            value={draft.notes}
            maxLength={4000}
            placeholder={t('fields.notesPlaceholder')}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </div>

      <section className="border-border space-y-2 rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <ListChecks className="text-primary h-4 w-4" />
          <h3 className="text-sm font-semibold">{t('tasks.title')}</h3>
          {progress !== null && (
            <span className="text-muted-foreground ml-auto text-xs">
              {t('tasks.progress', {
                done: tasks.filter((x) => x.done).length,
                total: tasks.length,
              })}
            </span>
          )}
        </div>
        {progress !== null && (
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {!draft.id ? (
          <p className="text-muted-foreground text-sm">
            {t('tasks.saveFirst')}
          </p>
        ) : (
          <>
            <ul className="space-y-1">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="hover:bg-muted/40 flex flex-wrap items-center gap-2 rounded-md px-1 py-1"
                >
                  <Checkbox
                    checked={task.done}
                    onCheckedChange={(v) =>
                      void updateTask(task, { done: !!v })
                    }
                    aria-label={task.title}
                  />
                  <span
                    className={cn(
                      'min-w-40 flex-1 text-sm',
                      task.done && 'text-muted-foreground line-through'
                    )}
                  >
                    {task.title}
                  </span>
                  <Input
                    type="date"
                    aria-label={t('tasks.due')}
                    value={task.due_date ?? ''}
                    onChange={(e) =>
                      void updateTask(task, {
                        due_date: e.target.value || null,
                      })
                    }
                    className="h-7 w-36 text-xs"
                  />
                  <Select
                    value={task.assignee_id ?? NONE}
                    onValueChange={(v) =>
                      void updateTask(task, {
                        assignee_id: !v || v === NONE ? null : v,
                      })
                    }
                  >
                    <SelectTrigger size="sm" className="w-36 text-xs">
                      <SelectValue>
                        {nameOf(task.assignee_id).split(' ')[0] ||
                          t('fields.nobody')}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('fields.nobody')}</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.full_name || m.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('tasks.remove')}
                    onClick={() => void removeTask(task)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                value={newTask}
                maxLength={200}
                placeholder={t('tasks.addPlaceholder')}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const title = newTask.trim();
                    if (title)
                      void addTasks([title]).then(() => setNewTask(''));
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const title = newTask.trim();
                  if (title) void addTasks([title]).then(() => setNewTask(''));
                }}
              >
                <Plus className="h-4 w-4" />
                {t('tasks.add')}
              </Button>
            </div>
            {tasks.length === 0 && (
              <button
                type="button"
                className="text-primary text-xs hover:underline"
                onClick={() =>
                  void addTasks(SUGGESTED_TASKS.map((k) => t(`suggested.${k}`)))
                }
              >
                {t('tasks.useSuggested')}
              </button>
            )}
          </>
        )}
      </section>

      <DialogFooter className="bg-popover border-border flex-row items-center sm:justify-between">
        {draft.id && canDelete ? (
          confirmDelete ? (
            <Button
              type="button"
              disabled={saving}
              onClick={() => void handleDelete()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {t('confirmDelete')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="text-red-400 hover:text-red-300"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
              {t('delete')}
            </Button>
          )
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {draft.id ? t('close') : t('cancel')}
          </Button>
          {draft.id ? (
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={saving}
              onClick={() => void handleSave(false)}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('create')}
            </Button>
          )}
        </div>
      </DialogFooter>
    </form>
  );
}
