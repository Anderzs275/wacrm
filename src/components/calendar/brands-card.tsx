'use client';

// ============================================================
// Brand list for the content calendar (content_brands, 104). Admins
// add, rename and delete; everyone else sees it read-only.
//
// Deleting can first move the brand's posts to another brand, which
// is how a duplicate ("Unno" vs "Unno Underwear") is merged. Without
// a target the posts keep existing with no brand (ON DELETE SET NULL).
// ============================================================

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { createBrand, type ContentBrand } from './use-content-calendar';

const NO_TARGET = 'none';

export function BrandsCard({
  brands,
  canManage,
  onChanged,
}: {
  brands: ContentBrand[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('Calendar.brands');
  const { accountId } = useAuth();
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null
  );
  const [deleting, setDeleting] = useState<ContentBrand | null>(null);
  const [target, setTarget] = useState(NO_TARGET);
  const [busy, setBusy] = useState(false);

  const failed = (err: unknown, fallback: string) => {
    const e = err as { code?: string; message?: string };
    toast.error(e.code === '23505' ? t('exists') : fallback, {
      description: e.code === '23505' ? undefined : e.message,
    });
  };

  async function handleAdd() {
    const name = (adding ?? '').trim();
    if (!name || !accountId) return;
    setBusy(true);
    try {
      await createBrand(accountId, name);
      setAdding(null);
      onChanged();
    } catch (err) {
      failed(err, t('addFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRename() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    setBusy(true);
    const { error } = await createClient()
      .from('content_brands')
      .update({ name })
      .eq('id', editing.id);
    setBusy(false);
    if (error) {
      failed(error, t('renameFailed'));
      return;
    }
    setEditing(null);
    onChanged();
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    const supabase = createClient();
    try {
      if (target !== NO_TARGET) {
        const { error } = await supabase
          .from('content_posts')
          .update({ brand_id: target })
          .eq('brand_id', deleting.id);
        if (error) throw error;
      }
      const { error } = await supabase
        .from('content_brands')
        .delete()
        .eq('id', deleting.id);
      if (error) throw error;
      toast.success(t('deleted', { name: deleting.name }));
      setDeleting(null);
      onChanged();
    } catch (err) {
      failed(err, t('deleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  const others = brands.filter((b) => b.id !== deleting?.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <GatedButton
            canAct={canManage}
            gateReason={t('gate')}
            size="sm"
            variant="outline"
            onClick={() => setAdding('')}
          >
            <Plus className="h-4 w-4" />
            {t('add')}
          </GatedButton>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        {adding !== null && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAdd();
            }}
          >
            <Input
              autoFocus
              value={adding}
              maxLength={60}
              placeholder={t('namePlaceholder')}
              onChange={(e) => setAdding(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={busy}>
              {t('save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(null)}
            >
              {t('cancel')}
            </Button>
          </form>
        )}

        {brands.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            {t('empty')}
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {brands.map((b) => (
              <li key={b.id} className="flex items-center gap-2 py-1.5">
                {editing?.id === b.id ? (
                  <form
                    className="flex flex-1 gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleRename();
                    }}
                  >
                    <Input
                      autoFocus
                      value={editing.name}
                      maxLength={60}
                      onChange={(e) =>
                        setEditing({ id: b.id, name: e.target.value })
                      }
                    />
                    <Button
                      type="submit"
                      size="icon-sm"
                      aria-label={t('save')}
                      disabled={busy}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('cancel')}
                      onClick={() => setEditing(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1 text-sm">{b.name}</span>
                    {canManage && (
                      <>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('rename')}
                          title={t('rename')}
                          onClick={() => setEditing({ id: b.id, name: b.name })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('delete')}
                          title={t('delete')}
                          className="text-red-400 hover:text-red-300"
                          onClick={() => {
                            setTarget(NO_TARGET);
                            setDeleting(b);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('deleteTitle', { name: deleting?.name ?? '' })}
            </DialogTitle>
            <DialogDescription>{t('deleteDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{t('moveTo')}</Label>
            <Select
              value={target}
              onValueChange={(v) => setTarget(v ?? NO_TARGET)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {others.find((b) => b.id === target)?.name ?? t('noBrand')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TARGET}>{t('noBrand')}</SelectItem>
                {others.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="bg-popover border-border">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t('cancel')}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void handleDelete()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
