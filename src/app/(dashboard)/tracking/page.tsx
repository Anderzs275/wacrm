'use client';

// ============================================================
// Tracking — import courier labels, review, notify.
//
// The PDF is read in this component and never uploaded: only the
// three fields the feature needs (name, phone, tracking code) are
// written to Supabase. See src/lib/tracking/pdf-text.ts for why.
//
// Import writes straight through the browser's Supabase client under
// RLS. It is an UPSERT with `ignoreDuplicates`, which is what makes
// re-uploading the same batch safe: rows already sent or discarded
// keep their status instead of reverting to pending.
//
// Sending goes through POST /api/tracking/send, because that needs
// the account's decrypted Meta token.
//
// Discarding and deleting are NOT the same decision. Discarding is a
// tombstone an agent leaves so the row is never notified, and it
// deliberately survives a re-upload. Deleting is admin-only
// housekeeping that removes the row outright, which means the next
// import of the same PDF brings it back as pending — that is the
// point of it: it is how the operator starts a batch over.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Loader2,
  Package,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { GatedButton } from '@/components/ui/gated-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCan } from '@/hooks/use-can';
import {
  duplicatePhones,
  parseOlvaLabels,
  type TrackingParseIssue,
} from '@/lib/tracking/olva-parser';
import { extractPdfText, PdfTextError } from '@/lib/tracking/pdf-text';

/**
 * Matches MAX_IDS in the send route. The 71-label batches this was
 * built for exceed what one sequential Meta run finishes inside the
 * route's 60s budget, so the selection is sent in chunks and the
 * progress counter reflects chunks completed, not a single request.
 */
const SEND_CHUNK = 25;

type ShipmentStatus = 'pending' | 'sent' | 'failed' | 'discarded';

/**
 * What the operator sees in the Estado column.
 *
 * `pending` in the database means "nobody has decided about this row
 * yet", which is true of a row with an unreadable phone too — and
 * that row can NEVER be sent. Showing both as one status invites the
 * operator to wait for something that is not coming, so the
 * unsendable case is split out for display only. The database keeps
 * four statuses; the column shows five.
 */
type DisplayStatus = ShipmentStatus | 'unsendable';

type RowFilter = 'all' | 'ready' | 'problem' | 'sent' | 'discarded';

/** What the last PDF import actually did, kept for the report card. */
interface ImportReport {
  /** Labels the parser read end to end. */
  read: number;
  /** `ENVIA:` blocks the split produced, read or not. */
  blocks: number;
  /** Total the labels themselves declare via "(n/71)". */
  declared: number | null;
  /** Rows the UPSERT actually inserted. */
  added: number;
  /** Tracking codes already in the list, left untouched. */
  skipped: string[];
  issues: TrackingParseIssue[];
}

interface ShipmentRow {
  id: string;
  tracking_code: string;
  recipient_name: string;
  greeting_name: string;
  raw_phone: string;
  phone: string | null;
  phone_problem: string | null;
  sequence: number | null;
  status: ShipmentStatus;
  error_message: string | null;
}

interface TemplateOption {
  name: string;
  language: string;
}

const STATUS_VARIANT: Record<DisplayStatus, string> = {
  pending: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
  unsendable: 'border-red-500/30 bg-red-500/10 text-red-400',
  sent: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  failed: 'border-red-500/30 bg-red-500/10 text-red-400',
  discarded: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
};

function displayStatus(row: ShipmentRow): DisplayStatus {
  return row.status === 'pending' && !row.phone ? 'unsendable' : row.status;
}

export default function TrackingPage() {
  const t = useTranslations('Tracking');
  const supabase = useMemo(() => createClient(), []);
  const canSend = useCan('send-messages');
  // Admin+, matching the table's DELETE policy. Rendering the button
  // for an agent would only produce a silent RLS no-op.
  const canPurge = useCan('purge-data');
  const fileInput = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [template, setTemplate] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [filter, setFilter] = useState<RowFilter>('all');

  const loadRows = useCallback(async () => {
    const { data, error } = await supabase
      .from('tracking_shipments')
      .select(
        'id, tracking_code, recipient_name, greeting_name, raw_phone, phone, phone_problem, sequence, status, error_message'
      )
      .order('created_at', { ascending: false })
      .order('sequence', { ascending: true });

    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as ShipmentRow[]);
  }, [supabase]);

  useEffect(() => {
    let active = true;

    (async () => {
      // Only APPROVED templates can actually be sent; offering the
      // rest just produces opaque Meta rejections at send time.
      const [{ data: tpl }] = await Promise.all([
        supabase
          .from('message_templates')
          .select('name, language, status')
          .eq('status', 'APPROVED')
          .order('name'),
        loadRows(),
      ]);

      if (!active) return;
      const options = (tpl ?? []).map((r) => ({
        name: r.name as string,
        language: (r.language as string) ?? 'es',
      }));
      setTemplates(options);
      setTemplate((current) => current || (options[0]?.name ?? ''));
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [supabase, loadRows]);

  // Phones carrying more than one parcel in the current list. Shown
  // as a warning per row, never merged — the operator asked for one
  // message per order.
  const repeated = useMemo(
    () =>
      duplicatePhones(
        rows.map((r) => ({
          e164: r.phone,
          trackingCode: r.tracking_code,
          recipientName: r.recipient_name,
          greetingName: r.greeting_name,
          rawPhone: r.raw_phone,
          phoneProblem: null,
          sequence: r.sequence,
          registro: null,
        }))
      ),
    [rows]
  );

  /** Rows a "Notificar" run would actually act on. */
  const sendableIds = useMemo(
    () =>
      rows
        .filter(
          (r) => r.phone && r.status !== 'sent' && r.status !== 'discarded'
        )
        .map((r) => r.id),
    [rows]
  );

  /**
   * Rows the checkboxes offer. Wider than `sendableIds` on purpose:
   * deleting is the one action that has to reach a discarded or sent
   * row, and the operator emptying the list to re-upload should not
   * have to do it row by row. The buttons narrow the selection to
   * what each action allows, so a sent row being ticked can never
   * turn into a second message.
   */
  const selectableIds = useMemo(
    () => (canPurge ? rows.map((r) => r.id) : sendableIds),
    [rows, sendableIds, canPurge]
  );

  /** Selection split per action, so every button's count is honest. */
  const selectedSendable = useMemo(
    () => [...selected].filter((id) => sendableIds.includes(id)),
    [selected, sendableIds]
  );
  const selectedDiscardable = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    return [...selected].filter((id) => {
      const row = byId.get(id);
      return !!row && row.status !== 'sent' && row.status !== 'discarded';
    });
  }, [selected, rows]);

  const counts = useMemo(() => {
    let ready = 0;
    let problem = 0;
    let sent = 0;
    let discarded = 0;
    for (const r of rows) {
      const st = displayStatus(r);
      if (st === 'sent') sent++;
      else if (st === 'discarded') discarded++;
      else if (st === 'unsendable' || st === 'failed') problem++;
      else ready++;
    }
    return { all: rows.length, ready, problem, sent, discarded };
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => {
      const st = displayStatus(r);
      if (filter === 'ready') return st === 'pending';
      if (filter === 'problem') return st === 'unsendable' || st === 'failed';
      if (filter === 'sent') return st === 'sent';
      return st === 'discarded';
    });
  }, [rows, filter]);

  async function handleFile(file: File) {
    setReport(null);
    setImporting(t('reading'));
    try {
      const text = await extractPdfText(file, ({ page, pages }) =>
        setImporting(t('readingPage', { page, pages }))
      );

      const { shipments, issues, declaredTotal, blockCount } =
        parseOlvaLabels(text);
      if (shipments.length === 0) {
        // Still worth a report: "0 rows" with the blocks it choked on
        // is diagnosable, "0 rows" on its own is not.
        setReport({
          read: 0,
          blocks: blockCount,
          declared: declaredTotal,
          added: 0,
          skipped: [],
          issues,
        });
        toast.error(t('noLabels'));
        return;
      }

      setImporting(t('saving'));
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id, user_id')
        .maybeSingle();
      if (!profile?.account_id) {
        toast.error(t('noAccount'));
        return;
      }

      // ignoreDuplicates is the whole safety story for a re-upload:
      // existing (account_id, tracking_code) rows are left exactly as
      // they are, so a discarded row stays discarded and a sent row
      // is never sent twice.
      const { data: inserted, error } = await supabase
        .from('tracking_shipments')
        .upsert(
          shipments.map((s) => ({
            account_id: profile.account_id,
            created_by: profile.user_id,
            tracking_code: s.trackingCode,
            recipient_name: s.recipientName,
            greeting_name: s.greetingName,
            raw_phone: s.rawPhone,
            phone: s.e164 ? s.e164.replace(/\D/g, '') : null,
            phone_problem: s.phoneProblem,
            sequence: s.sequence,
            registro: s.registro,
          })),
          { onConflict: 'account_id,tracking_code', ignoreDuplicates: true }
        )
        // `tracking_code` comes back so the report can name the rows
        // that were left alone, rather than only counting them: a
        // skipped row looks identical to a row the parser missed
        // unless the code is spelled out.
        .select('id, tracking_code');

      if (error) {
        toast.error(error.message);
        return;
      }

      const addedCodes = new Set(
        (inserted ?? []).map((r) => r.tracking_code as string)
      );
      const added = addedCodes.size;
      const skipped = shipments
        .map((s) => s.trackingCode)
        .filter((code) => !addedCodes.has(code));

      setReport({
        read: shipments.length,
        blocks: blockCount,
        declared: declaredTotal,
        added,
        skipped,
        issues,
      });

      toast.success(
        t('imported', {
          added,
          skipped: skipped.length,
          total: declaredTotal ?? shipments.length,
        })
      );
      if (issues.length > 0) toast.warning(t('issues', { n: issues.length }));

      await loadRows();
    } catch (err) {
      if (err instanceof PdfTextError) {
        toast.error(
          err.kind === 'no_text_layer' ? t('noTextLayer') : t('unreadable')
        );
      } else {
        toast.error(err instanceof Error ? err.message : t('unreadable'));
      }
    } finally {
      setImporting(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function handleDiscard(ids: string[]) {
    if (ids.length === 0) return;
    if (!confirm(t('confirmDiscard', { n: ids.length }))) return;

    const { error } = await supabase
      .from('tracking_shipments')
      .update({ status: 'discarded', discarded_at: new Date().toISOString() })
      .in('id', ids)
      // A sent message cannot be un-sent; discarding it would only
      // make the list lie about what the customer received.
      .neq('status', 'sent');

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('discarded', { n: ids.length }));
    setSelected(new Set());
    await loadRows();
  }

  /**
   * Permanent removal. Unlike discarding, this leaves nothing behind,
   * so re-uploading the same PDF re-imports these rows as pending —
   * which is exactly what the operator wants when starting a batch
   * over, and exactly what they must not do by accident to a row that
   * was discarded on purpose. The confirmation therefore names the
   * consequence rather than asking "are you sure?".
   */
  async function handleDelete(ids: string[]) {
    if (ids.length === 0) return;
    const sent = rows.filter(
      (r) => ids.includes(r.id) && r.status === 'sent'
    ).length;
    const message = sent
      ? t('confirmDeleteWithSent', { n: ids.length, sent })
      : t('confirmDelete', { n: ids.length });
    if (!confirm(message)) return;

    const { error } = await supabase
      .from('tracking_shipments')
      .delete()
      .in('id', ids);

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('deleted', { n: ids.length }));
    setSelected(new Set());
    await loadRows();
  }

  /**
   * "Empty the list". The one-click path for the actual workflow this
   * came from: the batch was reviewed wrong, the operator wants the
   * PDF re-read from zero. It clears every row the current filter is
   * showing, so "Descartados (3)" + this button is also how a single
   * bad discard gets undone.
   */
  async function handleClearVisible() {
    await handleDelete(visibleRows.map((r) => r.id));
  }

  async function handleSend() {
    const ids = selectedSendable;
    if (ids.length === 0) return;
    if (!template) {
      toast.error(t('pickTemplate'));
      return;
    }

    const language =
      templates.find((x) => x.name === template)?.language ?? 'es';
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += SEND_CHUNK) {
      chunks.push(ids.slice(i, i + SEND_CHUNK));
    }

    let sent = 0;
    let failed = 0;
    try {
      for (const [i, chunk] of chunks.entries()) {
        setSending(t('sendingChunk', { done: i + 1, total: chunks.length }));
        const res = await fetch('/api/tracking/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids: chunk,
            template_name: template,
            template_language: language,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error ?? t('sendFailed'));
          break;
        }
        sent += json.data.sent;
        failed += json.data.failed;
      }
      toast.success(t('sendSummary', { sent, failed }));
    } finally {
      setSending(null);
      setSelected(new Set());
      await loadRows();
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected =
    selectableIds.length > 0 && selected.size === selectableIds.length;
  const busy = importing !== null || sending !== null;

  /** Why "Notificar" is disabled, in the order the operator must fix. */
  const blocker: 'blockedNoTemplate' | 'blockedNoSelection' | null = !template
    ? 'blockedNoTemplate'
    : selectedSendable.length === 0 && sendableIds.length > 0
      ? 'blockedNoSelection'
      : null;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-semibold">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            {t('subtitle')}
          </p>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <GatedButton
          canAct={canSend}
          gateReason={t('gateImport')}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {importing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {importing}
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              {t('upload')}
            </>
          )}
        </GatedButton>
      </div>

      <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border p-3">
        <Select value={template} onValueChange={(v) => setTemplate(v ?? '')}>
          <SelectTrigger className="w-[260px]">
            <SelectValue
              placeholder={
                templates.length === 0 ? t('noTemplates') : t('pickTemplate')
              }
            />
          </SelectTrigger>
          <SelectContent>
            {templates.map((tpl) => (
              <SelectItem key={tpl.name} value={tpl.name}>
                {tpl.name} ({tpl.language})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-xs">
          {t('templateHint')}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {canPurge && (
            <Button
              variant="outline"
              className="text-red-400 hover:text-red-300"
              disabled={busy || selected.size === 0}
              onClick={() => void handleDelete([...selected])}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('deleteSelected', { n: selected.size })}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!canSend || busy || selectedDiscardable.length === 0}
            onClick={() => void handleDiscard(selectedDiscardable)}
          >
            {t('discardSelected', { n: selectedDiscardable.length })}
          </Button>
          <GatedButton
            canAct={canSend}
            gateReason={t('gateSend')}
            disabled={busy || selectedSendable.length === 0 || !template}
            onClick={() => void handleSend()}
          >
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {sending}
              </>
            ) : (
              t('notifySelected', { n: selectedSendable.length })
            )}
          </GatedButton>
        </div>

        {/* A disabled button that explains nothing is the same as a
            missing button: the operator sees "Listo para enviar" on
            every row and no way to act on it. Sending is gated on two
            independent things — an approved template and a selection
            — so the blocker is named rather than merely applied. */}
        {blocker && (
          <p className="w-full text-xs text-amber-400">{t(blocker)}</p>
        )}
      </div>

      {templates.length === 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="space-y-2">
              <h2 className="text-foreground text-sm font-semibold">
                {t('setupTemplateTitle')}
              </h2>
              <p className="text-muted-foreground text-sm">
                {t('setupTemplateBody')}
              </p>
              {/* The exact body, spelled out, because the two
                  variables have to be in this order: the send path
                  passes [greeting_name, tracking_code] positionally. */}
              <pre className="border-border bg-background/50 text-foreground rounded border p-2 text-xs whitespace-pre-wrap">
                {t('setupTemplateExample')}
              </pre>
              <Link
                href="/settings?tab=templates"
                className={buttonVariants({ size: 'sm' })}
              >
                {t('setupTemplateCta')}
              </Link>
            </div>
          </div>
        </div>
      )}

      {report && (
        <ImportReportCard
          report={report}
          onDismiss={() => setReport(null)}
          t={t}
        />
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['all', counts.all],
              ['ready', counts.ready],
              ['problem', counts.problem],
              ['sent', counts.sent],
              ['discarded', counts.discarded],
            ] as const
          ).map(([key, n]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === key
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`filter_${key}`)} ({n})
            </button>
          ))}

          {canPurge && visibleRows.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-red-400 hover:text-red-300"
              disabled={busy}
              onClick={() => void handleClearVisible()}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {filter === 'all'
                ? t('clearAll', { n: visibleRows.length })
                : t('clearFiltered', { n: visibleRows.length })}
            </Button>
          )}
        </div>
      )}

      {/* Deleting is not discarding, and the difference only matters
          at the moment someone reaches for it. */}
      {canPurge && rows.length > 0 && (
        <p className="text-muted-foreground text-xs">{t('deleteHint')}</p>
      )}

      {loading ? (
        <div className="text-muted-foreground flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="border-border flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <Package className="text-muted-foreground h-8 w-8" />
          <p className="text-muted-foreground text-sm">
            {rows.length === 0 ? t('empty') : t('noRowsForFilter')}
          </p>
        </div>
      ) : (
        <div className="border-border rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    disabled={
                      (!canSend && !canPurge) || selectableIds.length === 0
                    }
                    onCheckedChange={(v) =>
                      setSelected(v ? new Set(selectableIds) : new Set())
                    }
                    aria-label={t('selectAll')}
                  />
                </TableHead>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{t('colName')}</TableHead>
                <TableHead>{t('colPhone')}</TableHead>
                <TableHead>{t('colTracking')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => {
                // An admin can tick any row, because deleting has to
                // reach the sent and discarded ones; everyone else
                // only sees a checkbox where sending is possible.
                const selectable = selectableIds.includes(row.id);
                const isRepeat = row.phone
                  ? repeated.has('+' + row.phone)
                  : false;

                return (
                  <TableRow
                    key={row.id}
                    className={row.status === 'discarded' ? 'opacity-50' : ''}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.has(row.id)}
                        disabled={(!canSend && !canPurge) || !selectable}
                        onCheckedChange={() => toggle(row.id)}
                        aria-label={row.recipient_name}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {row.sequence ?? '—'}
                    </TableCell>
                    <TableCell>
                      <div className="text-foreground font-medium">
                        {row.recipient_name}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {t('greetsAs', { name: row.greeting_name })}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.phone ? (
                        <span className="font-mono text-sm">+{row.phone}</span>
                      ) : (
                        <div className="space-y-1">
                          <span className="font-mono text-sm line-through">
                            {row.raw_phone || '—'}
                          </span>
                          <Badge className="border-red-500/30 bg-red-500/10 text-red-400">
                            {t('invalidPhone')}
                          </Badge>
                        </div>
                      )}
                      {isRepeat && (
                        <Badge className="mt-1 border-amber-500/30 bg-amber-500/10 text-amber-400">
                          {t('repeatCustomer')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {row.tracking_code}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_VARIANT[displayStatus(row)]}>
                        {t(`status_${displayStatus(row)}`)}
                      </Badge>
                      {row.error_message && (
                        <div
                          className="mt-1 max-w-[220px] truncate text-xs text-red-400"
                          title={row.error_message}
                        >
                          {row.error_message}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {row.status !== 'sent' &&
                          row.status !== 'discarded' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!canSend || busy}
                              onClick={() => void handleDiscard([row.id])}
                            >
                              {t('discard')}
                            </Button>
                          )}
                        {canPurge && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground h-8 w-8 hover:text-red-400"
                            disabled={busy}
                            title={t('delete')}
                            onClick={() => void handleDelete([row.id])}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">{t('delete')}</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * The report card for the last import.
 *
 * Its reason for existing is that every way this import loses a row
 * used to be a toast that faded in four seconds: an unreadable block,
 * a block that swallowed the label next to it, a code already in the
 * list. The operator was left comparing a 71-label PDF against a
 * shorter table with no way to tell which of the three happened. The
 * headline is therefore the arithmetic — read vs. declared — because
 * that one line answers "did anything go missing?" before any detail
 * is read.
 */
function ImportReportCard({
  report,
  onDismiss,
  t,
}: {
  report: ImportReport;
  onDismiss: () => void;
  t: ReturnType<typeof useTranslations<'Tracking'>>;
}) {
  const missing = report.declared !== null ? report.declared - report.read : 0;
  const hasProblem = missing > 0 || report.issues.length > 0;

  return (
    <div
      className={`rounded-lg border p-4 ${
        hasProblem
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-border bg-card'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {hasProblem && (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            )}
            <h2 className="text-foreground text-sm font-semibold">
              {t('reportTitle')}
            </h2>
          </div>
          <p className="text-muted-foreground text-sm">
            {t('reportCounts', {
              read: report.read,
              added: report.added,
              skipped: report.skipped.length,
            })}
          </p>
          {missing > 0 && (
            <p className="text-sm font-medium text-amber-400">
              {t('reportMismatch', {
                missing,
                declared: report.declared ?? 0,
                read: report.read,
              })}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          <X className="h-4 w-4" />
          <span className="sr-only">{t('reportDismiss')}</span>
        </Button>
      </div>

      {report.skipped.length > 0 && (
        <p className="text-muted-foreground mt-3 text-xs">
          {t('reportSkippedCodes')}{' '}
          <span className="font-mono">{report.skipped.join(', ')}</span>
        </p>
      )}

      {report.issues.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-foreground text-xs font-medium">
            {t('reportIssues', { n: report.issues.length })}
          </p>
          <ul className="space-y-2">
            {report.issues.map((issue) => (
              <li
                key={`${issue.blockIndex}-${issue.reason}`}
                className="border-border bg-background/50 rounded border p-2"
              >
                <div className="text-xs font-medium text-amber-400">
                  {t('issueBlock', { n: issue.blockIndex })} ·{' '}
                  {issue.reason === 'merged'
                    ? t('issue_merged', {
                        codes: (issue.lostCodes ?? []).join(', '),
                      })
                    : t(`issue_${issue.reason}`)}
                </div>
                {/* The raw text is the only thing that explains WHY a
                    block failed, so it is shown verbatim rather than
                    summarised into a category the operator cannot act
                    on. */}
                <pre className="text-muted-foreground mt-1 max-h-24 overflow-auto text-[11px] leading-snug break-all whitespace-pre-wrap">
                  {issue.excerpt}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
