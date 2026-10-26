// ============================================================
// Tracking notification delivery — one message per parcel.
//
// Deliberately NOT built on `createBroadcast`/`deliverBroadcast`.
// That path collapses recipients that resolve to the same contact
// (broadcast-core.ts, "Collapse recipients that resolved to the SAME
// contact") and keeps only the first, which is exactly right for a
// campaign — nobody wants the same promo twice — and exactly wrong
// here. A customer with two parcels has two tracking codes, and
// dropping one means a package silently arrives unannounced.
//
// So this walks the selected rows directly and calls the same Meta
// primitive the broadcast fan-out uses underneath
// (`sendTemplateMessage`), reusing its config loading, template-row
// guard and phone-variant retry, without the deduplication.
//
// Best-effort per row: one failure never aborts the rest, and every
// outcome is stamped back onto the row so the operator sees which
// customers were actually reached.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/whatsapp/encryption";
import {
  isRecipientNotAllowedError,
  phoneVariants,
} from "@/lib/whatsapp/phone-utils";
import { resolveTemplateRow } from "@/lib/whatsapp/template-body";
import { sendTemplateMessage } from "@/lib/whatsapp/meta-api";
import { olvaLookupNumber } from "./tracking-code";

/** Status values the `tracking_shipments` CHECK constraint allows. */
export type ShipmentStatus = "pending" | "sent" | "failed" | "discarded";

export class TrackingSendError extends Error {
  constructor(
    readonly code:
      | "whatsapp_not_configured"
      | "template_malformed"
      | "template_missing"
      | "nothing_to_send",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "TrackingSendError";
  }
}

/** A row as loaded for sending. */
export interface SendableShipment {
  id: string;
  tracking_code: string;
  greeting_name: string;
  recipient_name: string;
  phone: string | null;
  status: ShipmentStatus;
}

export interface SendSummary {
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Rows that must never reach Meta, with the reason.
 *
 * Filtering here rather than in the UI means a stale browser tab, a
 * replayed request or a hand-rolled API call cannot re-send a row
 * that was already sent, nor revive one the operator discarded —
 * the "discarded is forever" promise has to hold server-side to mean
 * anything.
 */
export function partitionSendable(rows: SendableShipment[]): {
  sendable: SendableShipment[];
  skipped: { id: string; reason: string }[];
} {
  const sendable: SendableShipment[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const row of rows) {
    if (row.status === "sent") {
      skipped.push({ id: row.id, reason: "already_sent" });
      continue;
    }
    if (row.status === "discarded") {
      skipped.push({ id: row.id, reason: "discarded" });
      continue;
    }
    if (!row.phone) {
      skipped.push({ id: row.id, reason: "invalid_phone" });
      continue;
    }
    sendable.push(row);
  }

  return { sendable, skipped };
}

/**
 * Send the shipment notification for each row.
 *
 * `templateName` must name a Meta-approved template whose body takes
 * two variables, in this order: {{1}} the customer's first name and
 * {{2}} the tracking number (without the "-YY" year, see
 * tracking-code.ts). An optional COPY_CODE button copies that same
 * number.
 */
export async function sendTrackingNotifications(
  db: SupabaseClient,
  accountId: string,
  rows: SendableShipment[],
  params: { templateName: string; templateLanguage: string },
): Promise<SendSummary> {
  const { sendable, skipped } = partitionSendable(rows);
  if (sendable.length === 0) {
    return { sent: 0, failed: 0, skipped: skipped.length };
  }

  const { data: config, error: configError } = await db
    .from("whatsapp_config")
    .select("*")
    .eq("account_id", accountId)
    .single();
  if (configError || !config) {
    throw new TrackingSendError(
      "whatsapp_not_configured",
      "WhatsApp is not configured. Connect your number under Settings first.",
    );
  }
  const accessToken = decrypt(config.access_token);

  // Resolve the template once rather than per row: N identical
  // failures for one malformed local row is a bad way to learn the
  // row is malformed.
  const resolved = await resolveTemplateRow(
    db,
    accountId,
    params.templateName,
    params.templateLanguage,
  );
  if (resolved.malformed) {
    throw new TrackingSendError(
      "template_malformed",
      'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
      500,
    );
  }

  // Indices of COPY_CODE buttons. Each one must get this row's code at
  // send time — left alone, the send builder falls back to the
  // template's sample code and every customer would copy the same one.
  const copyCodeButtons = (resolved.row?.buttons ?? []).flatMap((b, i) =>
    b.type === "COPY_CODE" ? [i] : [],
  );

  let sent = 0;
  let failed = 0;

  for (const row of sendable) {
    const lookupNumber = olvaLookupNumber(row.tracking_code);
    const buttonParams = Object.fromEntries(
      copyCodeButtons.map((i) => [i, lookupNumber]),
    );

    // `phone` is non-null here: partitionSendable dropped the rest.
    const variants = phoneVariants(row.phone as string);
    let messageId: string | null = null;
    let lastError: string | null = null;

    for (const variant of variants) {
      try {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: variant,
          templateName: params.templateName,
          language: params.templateLanguage,
          template: resolved.row ?? undefined,
          // `params` is the body-only fallback used when the template
          // row is missing locally; `messageParams` wins when it exists.
          params: [row.greeting_name, lookupNumber],
          messageParams: {
            body: [row.greeting_name, lookupNumber],
            buttonParams,
          },
        });
        messageId = result.messageId;
        lastError = null;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown error";
        // Only a sandbox "recipient not allowed" is worth retrying
        // with a trunk-prefix variant; anything else is a real error.
        if (!isRecipientNotAllowedError(lastError)) break;
      }
    }

    if (messageId) {
      sent++;
      await db
        .from("tracking_shipments")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          whatsapp_message_id: messageId,
          error_message: null,
        })
        .eq("id", row.id)
        .eq("account_id", accountId);
    } else {
      failed++;
      await db
        .from("tracking_shipments")
        .update({
          status: "failed",
          error_message: lastError ?? "Unknown error",
        })
        .eq("id", row.id)
        .eq("account_id", accountId);
    }
  }

  return { sent, failed, skipped: skipped.length };
}
