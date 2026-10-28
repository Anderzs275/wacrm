'use client';

// ============================================================
// Create / edit a dated calendar event: a meeting (day, time, link)
// or one of the team's own key dates (a launch, a one-off día no
// laborable). Either can repeat ("todos los martes"); editing a
// repeating event edits the whole series. A key date can instead span
// several days (Cyber Wow) and be marked high priority.
// ============================================================

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Trash2, Video, Star } from 'lucide-react';

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
import { fromIsoDay } from '@/lib/calendar/month-grid';
import { REPEAT_RULES, type RepeatRule } from '@/lib/calendar/recurrence';
import { normalizeMeetingUrl } from '@/lib/team/meeting-url';
import { cn } from '@/lib/utils';
import {
  saveCalendarEvent,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarEventKind,
} from './use-content-calendar';

export interface EventDraft extends CalendarEventInput {
  id: string | null;
  created_by: string | null;
}

export function newEventDraft(
  day: string,
  kind: CalendarEventKind = 'meeting'
): EventDraft {
  return {
    id: null,
    kind,
    title: '',
    event_date: day,
    start_time: kind === 'meeting' ? '10:00' : null,
    end_time: null,
    url: null,
    notes: '',
    repeat: 'none',
    repeat_until: null,
    end_date: null,
    priority: 'normal',
    created_by: null,
  };
}

/** Accepts an occurrence too; the draft always edits the series. */
export function eventDraftFrom(event: CalendarEvent): EventDraft {
  return {
    id: event.id,
    kind: event.kind,
    title: event.title,
    event_date: event.event_date,
    start_time: event.start_time,
    end_time: event.end_time,
    url: event.url,
    notes: event.notes,
    repeat: event.repeat,
    repeat_until: event.repeat_until,
    end_date: event.end_date,
    priority: event.priority,
    created_by: event.created_by,
  };
}

export function EventDialog({
  draft,
  onClose,
  onSaved,
  isAdmin,
}: {
  draft: EventDraft | null;
  onClose: () => void;
  onSaved: () => void;
  isAdmin: boolean;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-popover border-border max-h-[90vh] overflow-y-auto sm:max-w-md">
        {draft && (
          <EventForm
            key={draft.id ?? `new-${draft.event_date}-${draft.kind}`}
            initial={draft}
            onClose={onClose}
            onSaved={onSaved}
            isAdmin={isAdmin}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EventForm({
  initial,
  onClose,
  onSaved,
  isAdmin,
}: {
  initial: EventDraft;
  onClose: () => void;
  onSaved: () => void;
  isAdmin: boolean;
}) {
  const t = useTranslations('Calendar.event');
  const format = useFormatter();
  const { accountId, user } = useAuth();
  const [draft, setDraft] = useState(initial);
  const [urlText, setUrlText] = useState(initial.url ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const isMeeting = draft.kind === 'meeting';
  const isSpan =
    !isMeeting && !!draft.end_date && draft.end_date !== draft.event_date;
  const canDelete = !!draft.id && (isAdmin || draft.created_by === user?.id);
  const weekday = draft.event_date
    ? format.dateTime(fromIsoDay(draft.event_date), { weekday: 'long' })
    : '';
  const repeatLabel = (rule: RepeatRule) => t(`repeat.${rule}`, { weekday });

  async function handleSave() {
    if (!accountId) return;
    const title = draft.title.trim();
    if (!title) {
      toast.error(t('titleRequired'));
      return;
    }
    if (!draft.event_date) {
      toast.error(t('dateRequired'));
      return;
    }
    let url: string | null = null;
    if (isMeeting && urlText.trim()) {
      url = normalizeMeetingUrl(urlText);
      if (!url) {
        toast.error(t('invalidUrl'));
        return;
      }
    }
    // A span (several days) is a key date only, without a time or repeat.
    const endDate =
      !isMeeting && draft.end_date && draft.end_date !== draft.event_date
        ? draft.end_date
        : null;
    if (endDate && endDate < draft.event_date) {
      toast.error(t('spanEndBeforeStart'));
      return;
    }
    const start = endDate ? null : draft.start_time || null;
    const end = isMeeting ? draft.end_time || null : null;
    if (start && end && end <= start) {
      toast.error(t('endBeforeStart'));
      return;
    }
    const repeat = endDate ? 'none' : draft.repeat;
    const repeatUntil = repeat === 'none' ? null : draft.repeat_until || null;
    if (repeatUntil && repeatUntil < draft.event_date) {
      toast.error(t('untilBeforeStart'));
      return;
    }
    setSaving(true);
    try {
      await saveCalendarEvent(accountId, draft.id, {
        kind: draft.kind,
        title,
        event_date: draft.event_date,
        start_time: start,
        end_time: end,
        url,
        notes: draft.notes.trim(),
        repeat,
        repeat_until: repeatUntil,
        end_date: endDate,
        priority: draft.priority,
      });
      toast.success(draft.id ? t('updated') : t('created'));
      onSaved();
      onClose();
    } catch (err) {
      // Supabase errors are plain objects, not Error instances.
      const message = (err as { message?: string })?.message;
      console.error('[EventDialog] save failed:', message ?? err);
      toast.error(t('saveFailed'), { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft.id) return;
    setSaving(true);
    const { error } = await createClient()
      .from('calendar_events')
      .delete()
      .eq('id', draft.id);
    setSaving(false);
    if (error) {
      console.error('[EventDialog] delete failed:', error.message);
      toast.error(t('deleteFailed'));
      return;
    }
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
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>

      <div className="border-border flex rounded-lg border p-0.5">
        {(['meeting', 'key_date'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={draft.kind === kind}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                kind,
                start_time:
                  kind === 'meeting' ? (d.start_time ?? '10:00') : null,
                end_time: kind === 'meeting' ? d.end_time : null,
                end_date: kind === 'meeting' ? null : d.end_date,
              }))
            }
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
              draft.kind === kind
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground'
            )}
          >
            {kind === 'meeting' ? (
              <Video className="h-4 w-4" />
            ) : (
              <Star className="h-4 w-4" />
            )}
            {t(`kind.${kind}`)}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="event-title">{t('fieldTitle')}</Label>
        <Input
          id="event-title"
          value={draft.title}
          maxLength={120}
          placeholder={
            isMeeting ? t('titlePlaceholderMeeting') : t('titlePlaceholderDate')
          }
          onChange={(e) => set('title', e.target.value)}
        />
      </div>

      {isMeeting ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label htmlFor="event-date">{t('fieldDate')}</Label>
            <Input
              id="event-date"
              type="date"
              value={draft.event_date}
              onChange={(e) => set('event_date', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-start">{t('fieldStart')}</Label>
            <Input
              id="event-start"
              type="time"
              value={draft.start_time ?? ''}
              onChange={(e) => set('start_time', e.target.value || null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-end">{t('fieldEnd')}</Label>
            <Input
              id="event-end"
              type="time"
              value={draft.end_time ?? ''}
              onChange={(e) => set('end_time', e.target.value || null)}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="event-date">{t('fieldFrom')}</Label>
            <Input
              id="event-date"
              type="date"
              value={draft.event_date}
              onChange={(e) => set('event_date', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-end-date">{t('fieldTo')}</Label>
            <Input
              id="event-end-date"
              type="date"
              min={draft.event_date}
              value={draft.end_date ?? ''}
              onChange={(e) => set('end_date', e.target.value || null)}
            />
          </div>
          {!isSpan && (
            <div className="space-y-2">
              <Label htmlFor="event-start">{t('fieldTimeOptional')}</Label>
              <Input
                id="event-start"
                type="time"
                value={draft.start_time ?? ''}
                onChange={(e) => set('start_time', e.target.value || null)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>{t('fieldPriority')}</Label>
            <div className="border-border flex rounded-lg border p-0.5">
              {(['normal', 'high'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={draft.priority === p}
                  onClick={() => set('priority', p)}
                  className={cn(
                    'flex-1 rounded-md px-2 py-1 text-sm font-medium',
                    draft.priority === p
                      ? p === 'high'
                        ? 'bg-orange-500 text-white'
                        : 'bg-primary/10 text-primary'
                      : 'text-muted-foreground'
                  )}
                >
                  {t(`priority.${p}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isMeeting && (
        <div className="space-y-2">
          <Label htmlFor="event-url">{t('fieldUrl')}</Label>
          <Input
            id="event-url"
            value={urlText}
            inputMode="url"
            placeholder="https://meet.google.com/abc-defg-hij"
            onChange={(e) => setUrlText(e.target.value)}
          />
        </div>
      )}

      {!isSpan && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>{t('fieldRepeat')}</Label>
            <Select
              value={draft.repeat}
              onValueChange={(v) => v && set('repeat', v as RepeatRule)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{repeatLabel(draft.repeat)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REPEAT_RULES.map((rule) => (
                  <SelectItem key={rule} value={rule}>
                    {repeatLabel(rule)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {draft.repeat !== 'none' && (
            <div className="space-y-2">
              <Label htmlFor="event-until">{t('fieldUntil')}</Label>
              <Input
                id="event-until"
                type="date"
                min={draft.event_date}
                value={draft.repeat_until ?? ''}
                onChange={(e) => set('repeat_until', e.target.value || null)}
              />
            </div>
          )}
        </div>
      )}
      {draft.id && !isSpan && draft.repeat !== 'none' && (
        <p className="text-muted-foreground -mt-2 text-xs">{t('seriesHint')}</p>
      )}

      <div className="space-y-2">
        <Label htmlFor="event-notes">{t('fieldNotes')}</Label>
        <Textarea
          id="event-notes"
          rows={2}
          value={draft.notes}
          maxLength={2000}
          placeholder={
            isMeeting ? t('notesPlaceholderMeeting') : t('notesPlaceholderDate')
          }
          onChange={(e) => set('notes', e.target.value)}
        />
      </div>

      <DialogFooter className="bg-popover border-border flex-row items-center sm:justify-between">
        {canDelete ? (
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
