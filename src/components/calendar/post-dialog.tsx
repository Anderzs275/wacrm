'use client';

// ============================================================
// Create / edit one planned post. Same fields as the marketing Excel:
// date, category, brand, format, product, idea, copy, assignees and
// status. Brand comes from the managed list (admins can add one
// inline); assignees are CRM members.
// ============================================================

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';

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
  CATEGORY_DOT_CLASS,
  CONTENT_CATEGORIES,
  CONTENT_FORMATS,
  CONTENT_STATUSES,
  STATUS_BADGE_CLASS,
  type ContentCategory,
  type ContentFormat,
} from '@/lib/calendar/content-meta';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import {
  createBrand,
  saveContentPost,
  type ContentBrand,
  type ContentPost,
  type ContentPostInput,
} from './use-content-calendar';

const NO_BRAND = 'none';

export interface PostDraft extends ContentPostInput {
  id: string | null;
  /** Assignees as loaded, to diff against on save. */
  originalAssignees: string[];
}

export function newDraft(day: string): PostDraft {
  return {
    id: null,
    publish_date: day,
    category: 'product',
    brand_id: null,
    format: 'carousel',
    product: '',
    idea: '',
    caption: '',
    status: 'pending',
    assignees: [],
    originalAssignees: [],
  };
}

export function draftFrom(post: ContentPost): PostDraft {
  return { ...post, originalAssignees: post.assignees };
}

export function PostDialog({
  draft,
  onClose,
  onSaved,
  members,
  brands,
  canDelete,
  canManageBrands,
}: {
  draft: PostDraft | null;
  onClose: () => void;
  onSaved: () => void;
  members: AccountMember[];
  brands: ContentBrand[];
  canDelete: boolean;
  canManageBrands: boolean;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-popover border-border max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {draft && (
          <PostForm
            key={draft.id ?? `new-${draft.publish_date}`}
            initial={draft}
            onClose={onClose}
            onSaved={onSaved}
            members={members}
            brands={brands}
            canDelete={canDelete}
            canManageBrands={canManageBrands}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PostForm({
  initial,
  onClose,
  onSaved,
  members,
  brands,
  canDelete,
  canManageBrands,
}: {
  initial: PostDraft;
  onClose: () => void;
  onSaved: () => void;
  members: AccountMember[];
  brands: ContentBrand[];
  canDelete: boolean;
  canManageBrands: boolean;
}) {
  const t = useTranslations('Calendar');
  const { accountId } = useAuth();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newBrand, setNewBrand] = useState<string | null>(null);
  // Brands created from this form show up before Realtime refetches.
  const [addedBrands, setAddedBrands] = useState<ContentBrand[]>([]);
  const brandList = [
    ...brands,
    ...addedBrands.filter((a) => !brands.some((b) => b.id === a.id)),
  ];

  async function handleAddBrand() {
    const name = (newBrand ?? '').trim();
    if (!name || !accountId) return;
    try {
      const brand = await createBrand(accountId, name);
      setAddedBrands((list) => [...list, brand]);
      set('brand_id', brand.id);
      setNewBrand(null);
    } catch (err) {
      const code = (err as { code?: string }).code;
      toast.error(code === '23505' ? t('brandExists') : t('brandFailed'));
    }
  }

  const set = <K extends keyof PostDraft>(key: K, value: PostDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function toggleAssignee(userId: string) {
    set(
      'assignees',
      draft.assignees.includes(userId)
        ? draft.assignees.filter((u) => u !== userId)
        : [...draft.assignees, userId]
    );
  }

  async function handleSave() {
    if (!accountId) return;
    if (!draft.publish_date) {
      toast.error(t('dateRequired'));
      return;
    }
    if (!draft.idea.trim() && !draft.product.trim()) {
      toast.error(t('ideaRequired'));
      return;
    }
    setSaving(true);
    try {
      const { id, originalAssignees, ...input } = draft;
      await saveContentPost(
        accountId,
        id,
        {
          ...input,
          product: input.product.trim(),
          idea: input.idea.trim(),
          caption: input.caption.trim(),
        },
        originalAssignees
      );
      toast.success(id ? t('updated') : t('created'));
      onSaved();
      onClose();
    } catch (err) {
      // Supabase errors are plain objects, not Error instances.
      const message = (err as { message?: string })?.message;
      console.error('[PostDialog] save failed:', message ?? err);
      toast.error(t('saveFailed'), { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft.id) return;
    setSaving(true);
    const { error } = await createClient()
      .from('content_posts')
      .delete()
      .eq('id', draft.id);
    setSaving(false);
    if (error) {
      console.error('[PostDialog] delete failed:', error.message);
      toast.error(t('deleteFailed'));
      return;
    }
    toast.success(t('deleted'));
    onSaved();
    onClose();
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
    >
      <DialogHeader>
        <DialogTitle>{draft.id ? t('editTitle') : t('newTitle')}</DialogTitle>
        <DialogDescription>{t('dialogDescription')}</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label>{t('fields.status')}</Label>
        <div className="flex flex-wrap gap-1.5">
          {CONTENT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={draft.status === s}
              onClick={() => set('status', s)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition',
                draft.status === s
                  ? STATUS_BADGE_CLASS[s]
                  : 'border-border text-muted-foreground hover:bg-muted',
                draft.status === s && 'ring-foreground/20 ring-2'
              )}
            >
              {t(`status.${s}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="post-date">{t('fields.date')}</Label>
          <Input
            id="post-date"
            type="date"
            value={draft.publish_date}
            onChange={(e) => set('publish_date', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('fields.category')}</Label>
          <Select
            value={draft.category}
            onValueChange={(v) => v && set('category', v as ContentCategory)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      CATEGORY_DOT_CLASS[draft.category]
                    )}
                  />
                  {t(`category.${draft.category}`)}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CONTENT_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        CATEGORY_DOT_CLASS[c]
                      )}
                    />
                    {t(`category.${c}`)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {t(`categoryGoal.${draft.category}`)}
          </p>
        </div>
        <div className="space-y-2">
          <Label>{t('fields.brand')}</Label>
          <Select
            value={draft.brand_id ?? NO_BRAND}
            onValueChange={(v) =>
              set('brand_id', !v || v === NO_BRAND ? null : v)
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {brandList.find((b) => b.id === draft.brand_id)?.name ??
                  t('fields.noBrand')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_BRAND}>{t('fields.noBrand')}</SelectItem>
              {brandList.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManageBrands &&
            (newBrand === null ? (
              <button
                type="button"
                className="text-primary text-xs hover:underline"
                onClick={() => setNewBrand('')}
              >
                {t('fields.addBrand')}
              </button>
            ) : (
              <div className="flex gap-1.5">
                <Input
                  autoFocus
                  value={newBrand}
                  maxLength={60}
                  placeholder={t('fields.newBrandPlaceholder')}
                  onChange={(e) => setNewBrand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAddBrand();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleAddBrand()}
                >
                  {t('fields.addBrandSave')}
                </Button>
              </div>
            ))}
        </div>
        <div className="space-y-2">
          <Label>{t('fields.format')}</Label>
          <Select
            value={draft.format}
            onValueChange={(v) => v && set('format', v as ContentFormat)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{t(`format.${draft.format}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CONTENT_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`format.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="post-product">{t('fields.product')}</Label>
        <Input
          id="post-product"
          value={draft.product}
          maxLength={120}
          placeholder={t('fields.productPlaceholder')}
          onChange={(e) => set('product', e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="post-idea">{t('fields.idea')}</Label>
        <Textarea
          id="post-idea"
          rows={2}
          value={draft.idea}
          maxLength={500}
          placeholder={t('fields.ideaPlaceholder')}
          onChange={(e) => set('idea', e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="post-caption">{t('fields.caption')}</Label>
        <Textarea
          id="post-caption"
          rows={3}
          value={draft.caption}
          maxLength={4000}
          placeholder={t('fields.captionPlaceholder')}
          onChange={(e) => set('caption', e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('fields.assignees')}</Label>
        <div className="border-border flex flex-wrap gap-1 rounded-lg border p-2">
          {members.map((m) => (
            <label
              key={m.user_id}
              className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm"
            >
              <Checkbox
                checked={draft.assignees.includes(m.user_id)}
                onCheckedChange={() => toggleAssignee(m.user_id)}
              />
              {m.full_name || m.email || '—'}
            </label>
          ))}
        </div>
      </div>

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
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
