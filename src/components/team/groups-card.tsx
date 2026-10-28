'use client';

// ============================================================
// Team labels (Marketing, Ventas, …). Admins create, rename, recolour
// and staff them; everyone else sees them read-only. Labels grant no
// permissions — they exist to group people and, later, to filter the
// content calendar.
// ============================================================

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useAuth } from '@/hooks/use-auth';
import {
  DEFAULT_TEAM_COLOR,
  TEAM_CHIP_CLASS,
  TEAM_COLORS,
  TEAM_SWATCH_CLASS,
  type TeamColor,
} from '@/lib/team/colors';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import type { TeamGroup } from './use-team-space';

interface Draft {
  id: string | null;
  name: string;
  color: TeamColor;
  memberIds: Set<string>;
}

export function GroupsCard({
  groups,
  membership,
  members,
  canManage,
  onChanged,
}: {
  groups: TeamGroup[];
  membership: Map<string, Set<string>>;
  members: AccountMember[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('Team.groups');
  const { accountId } = useAuth();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<TeamGroup | null>(null);
  const [saving, setSaving] = useState(false);

  const membersOf = (groupId: string) =>
    members.filter((m) => membership.get(groupId)?.has(m.user_id));

  async function handleSave() {
    if (!draft || !accountId) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error(t('nameRequired'));
      return;
    }
    setSaving(true);
    const supabase = createClient();
    try {
      let groupId = draft.id;
      if (groupId) {
        const { error } = await supabase
          .from('team_groups')
          .update({ name, color: draft.color })
          .eq('id', groupId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('team_groups')
          .insert({ account_id: accountId, name, color: draft.color })
          .select('id')
          .single();
        if (error) throw error;
        groupId = data.id as string;
      }

      const before = membership.get(groupId) ?? new Set<string>();
      const added = [...draft.memberIds].filter((id) => !before.has(id));
      const removed = [...before].filter((id) => !draft.memberIds.has(id));
      if (added.length > 0) {
        const { error } = await supabase
          .from('team_group_members')
          .insert(added.map((user_id) => ({ group_id: groupId, user_id })));
        if (error) throw error;
      }
      if (removed.length > 0) {
        const { error } = await supabase
          .from('team_group_members')
          .delete()
          .eq('group_id', groupId)
          .in('user_id', removed);
        if (error) throw error;
      }
      toast.success(t('saved'));
      setDraft(null);
    } catch (err) {
      console.error('[GroupsCard] save failed:', err);
      // 23505: the unique (account, lower(name)) index.
      const code = (err as { code?: string }).code;
      toast.error(code === '23505' ? t('duplicateName') : t('saveFailed'));
    } finally {
      setSaving(false);
      await onChanged().catch(() => undefined);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setSaving(true);
    const { error } = await createClient()
      .from('team_groups')
      .delete()
      .eq('id', deleting.id);
    setSaving(false);
    if (error) {
      console.error('[GroupsCard] delete failed:', error);
      toast.error(t('deleteFailed'));
      return;
    }
    setDeleting(null);
    await onChanged().catch(() => undefined);
  }

  function toggleMember(userId: string) {
    if (!draft) return;
    const next = new Set(draft.memberIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setDraft({ ...draft, memberIds: next });
  }

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
            onClick={() =>
              setDraft({
                id: null,
                name: '',
                color: DEFAULT_TEAM_COLOR,
                memberIds: new Set(),
              })
            }
          >
            <Plus className="h-4 w-4" />
            {t('add')}
          </GatedButton>
        </CardAction>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            {canManage ? t('emptyAdmin') : t('empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => {
              const people = membersOf(g.id);
              return (
                <li
                  key={g.id}
                  className="border-border flex items-center gap-3 rounded-lg border px-3 py-2"
                >
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs font-medium',
                      TEAM_CHIP_CLASS[g.color]
                    )}
                  >
                    {g.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t('count', { n: people.length })}
                  </span>
                  <AvatarGroup className="ml-auto">
                    {people.slice(0, 5).map((p) => (
                      <Avatar
                        key={p.user_id}
                        className="size-6"
                        title={p.full_name}
                      >
                        {p.avatar_url ? (
                          <AvatarImage src={p.avatar_url} alt={p.full_name} />
                        ) : null}
                        <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                          {(p.full_name || '?').charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                  </AvatarGroup>
                  {canManage && (
                    <div className="flex items-center">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('edit')}
                        title={t('edit')}
                        onClick={() =>
                          setDraft({
                            id: g.id,
                            name: g.name,
                            color: g.color,
                            memberIds: new Set(membership.get(g.id) ?? []),
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('delete')}
                        title={t('delete')}
                        className="text-red-400 hover:text-red-300"
                        onClick={() => setDeleting(g)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
      >
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? t('editTitle') : t('addTitle')}
            </DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>
          {draft && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSave();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="group-name">{t('fieldName')}</Label>
                <Input
                  id="group-name"
                  value={draft.name}
                  maxLength={40}
                  placeholder={t('fieldNamePlaceholder')}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('fieldColor')}</Label>
                <div className="flex gap-2">
                  {TEAM_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={t(`color.${c}`)}
                      aria-pressed={draft.color === c}
                      title={t(`color.${c}`)}
                      onClick={() => setDraft({ ...draft, color: c })}
                      className={cn(
                        'ring-offset-popover size-7 rounded-full ring-offset-2 transition',
                        TEAM_SWATCH_CLASS[c],
                        draft.color === c
                          ? 'ring-foreground ring-2'
                          : 'opacity-70 hover:opacity-100'
                      )}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('fieldMembers')}</Label>
                <ul className="border-border max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {members.map((m) => (
                    <li key={m.user_id}>
                      <label className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                        <Checkbox
                          checked={draft.memberIds.has(m.user_id)}
                          onCheckedChange={() => toggleMember(m.user_id)}
                        />
                        {m.full_name || m.email || '—'}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
              <DialogFooter className="bg-popover border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDraft(null)}
                >
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('save')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('deleteDescription', { name: deleting?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t('cancel')}
            </Button>
            <Button
              disabled={saving}
              onClick={() => void handleDelete()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
