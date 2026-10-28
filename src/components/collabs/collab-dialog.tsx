'use client';

// ============================================================
// Create / edit an influencer or brand collaboration: who, where
// (platform, handle, profile link), the deal (exchange, paid,
// affiliate), what was sent, when it goes live and who handles it.
// ============================================================

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
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
import { normalizeMeetingUrl } from '@/lib/team/meeting-url';
import {
  COLLAB_KINDS,
  COLLAB_PLATFORMS,
  COLLAB_STATUSES,
  parseAmount,
  type CollabKind,
  type CollabPlatform,
  type CollabStatus,
} from '@/lib/team/work-meta';
import type { AccountMember } from '@/types';
import {
  saveCollaboration,
  type Collaboration,
  type CollaborationInput,
} from './use-collaborations';

const NONE = 'none';

export interface CollabDraft extends CollaborationInput {
  id: string | null;
}

export function newCollabDraft(status: CollabStatus = 'prospect'): CollabDraft {
  return {
    id: null,
    name: '',
    handle: '',
    platform: 'instagram',
    kind: 'exchange',
    status,
    amount: null,
    products: '',
    publish_date: null,
    url: null,
    owner_id: null,
    notes: '',
  };
}

export function collabDraftFrom(c: Collaboration): CollabDraft {
  return { ...c };
}

export function CollabDialog({
  draft,
  members,
  canDelete,
  onClose,
  onChanged,
}: {
  draft: CollabDraft | null;
  members: AccountMember[];
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-popover border-border max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {draft && (
          <CollabForm
            key={draft.id ?? 'new'}
            initial={draft}
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

function CollabForm({
  initial,
  members,
  canDelete,
  onClose,
  onChanged,
}: {
  initial: CollabDraft;
  members: AccountMember[];
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('Collabs');
  const { accountId } = useAuth();
  const [draft, setDraft] = useState(initial);
  const [amountText, setAmountText] = useState(
    initial.amount === null ? '' : String(initial.amount)
  );
  const [urlText, setUrlText] = useState(initial.url ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof CollabDraft>(key: K, value: CollabDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const ownerName =
    members.find((m) => m.user_id === draft.owner_id)?.full_name ?? '';

  async function handleSave() {
    if (!accountId) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error(t('nameRequired'));
      return;
    }
    const amount = parseAmount(amountText);
    if (Number.isNaN(amount)) {
      toast.error(t('invalidAmount'));
      return;
    }
    let url: string | null = null;
    if (urlText.trim()) {
      url = normalizeMeetingUrl(urlText);
      if (!url) {
        toast.error(t('invalidUrl'));
        return;
      }
    }
    setSaving(true);
    try {
      const { id, ...input } = draft;
      await saveCollaboration(accountId, id, {
        ...input,
        name,
        handle: input.handle.trim(),
        products: input.products.trim(),
        notes: input.notes.trim(),
        amount,
        url,
      });
      toast.success(t('saved'));
      onChanged();
      onClose();
    } catch (err) {
      toast.error(t('saveFailed'), {
        description: (err as { message?: string })?.message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft.id) return;
    setSaving(true);
    const { error } = await createClient()
      .from('collaborations')
      .delete()
      .eq('id', draft.id);
    setSaving(false);
    if (error) {
      toast.error(t('saveFailed'), { description: error.message });
      return;
    }
    onChanged();
    onClose();
  }

  const pick = <V extends string>(
    label: string,
    value: V,
    values: readonly V[],
    labelOf: (v: V) => string,
    onChange: (v: V) => void
  ) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => v && onChange(v as V)}>
        <SelectTrigger className="w-full">
          <SelectValue>{labelOf(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {values.map((v) => (
            <SelectItem key={v} value={v}>
              {labelOf(v)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="collab-name">{t('fields.name')}</Label>
          <Input
            id="collab-name"
            value={draft.name}
            maxLength={120}
            placeholder={t('fields.namePlaceholder')}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="collab-handle">{t('fields.handle')}</Label>
          <Input
            id="collab-handle"
            value={draft.handle}
            maxLength={120}
            placeholder="@usuario"
            onChange={(e) => set('handle', e.target.value)}
          />
        </div>
        {pick(
          t('fields.status'),
          draft.status,
          COLLAB_STATUSES,
          (v) => t(`status.${v}`),
          (v) => set('status', v as CollabStatus)
        )}
        {pick(
          t('fields.platform'),
          draft.platform,
          COLLAB_PLATFORMS,
          (v) => t(`platform.${v}`),
          (v) => set('platform', v as CollabPlatform)
        )}
        {pick(
          t('fields.kind'),
          draft.kind,
          COLLAB_KINDS,
          (v) => t(`kind.${v}`),
          (v) => set('kind', v as CollabKind)
        )}
        <div className="space-y-2">
          <Label htmlFor="collab-amount">{t('fields.amount')}</Label>
          <Input
            id="collab-amount"
            inputMode="decimal"
            value={amountText}
            placeholder={t('fields.amountPlaceholder')}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="collab-date">{t('fields.publishDate')}</Label>
          <Input
            id="collab-date"
            type="date"
            value={draft.publish_date ?? ''}
            onChange={(e) => set('publish_date', e.target.value || null)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('fields.owner')}</Label>
          <Select
            value={draft.owner_id ?? NONE}
            onValueChange={(v) => set('owner_id', !v || v === NONE ? null : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{ownerName || t('fields.nobody')}</SelectValue>
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
          <Label htmlFor="collab-url">{t('fields.url')}</Label>
          <Input
            id="collab-url"
            inputMode="url"
            value={urlText}
            placeholder="https://instagram.com/usuario"
            onChange={(e) => setUrlText(e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="collab-products">{t('fields.products')}</Label>
          <Input
            id="collab-products"
            value={draft.products}
            maxLength={500}
            placeholder={t('fields.productsPlaceholder')}
            onChange={(e) => set('products', e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="collab-notes">{t('fields.notes')}</Label>
          <Textarea
            id="collab-notes"
            rows={3}
            value={draft.notes}
            maxLength={4000}
            placeholder={t('fields.notesPlaceholder')}
            onChange={(e) => set('notes', e.target.value)}
          />
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
