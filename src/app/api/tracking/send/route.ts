// ============================================================
// POST /api/tracking/send — notify the selected shipments.
//
// Body: { ids: string[], template_name: string, template_language?: string }
//
// Server-side because the send needs the account's decrypted Meta
// access token, which never leaves the server. The import and discard
// paths have no such need and run straight off the browser's Supabase
// client under RLS, so this is the only route the feature adds.
//
// agent+ only. The RLS policy on `tracking_shipments` enforces the
// same boundary for the row updates, but the check is repeated here
// so a viewer gets a clean 403 instead of a confusing partial write.
// ============================================================

import { after } from "next/server";
import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/account";
import { toErrorResponse } from "@/lib/auth/account";
import {
  sendTrackingNotifications,
  TrackingSendError,
  type SendableShipment,
} from "@/lib/tracking/send";

// Sends run sequentially against Meta, like the broadcast fan-out.
// The UI batches selections rather than relying on a long request:
// see MAX_IDS below.
export const maxDuration = 60;

/**
 * Cap per request. A 71-label batch exceeds what one sequential run
 * can finish inside `maxDuration`, and a request cut off mid-flight
 * leaves rows stamped inconsistently. The UI sends in chunks; this is
 * the server-side floor under that behaviour.
 */
const MAX_IDS = 25;

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");

    const body = (await request.json().catch(() => null)) as {
      ids?: unknown;
      template_name?: unknown;
      template_language?: unknown;
    } | null;

    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((v): v is string => typeof v === "string")
      : [];
    const templateName =
      typeof body?.template_name === "string" ? body.template_name : "";
    const templateLanguage =
      typeof body?.template_language === "string" && body.template_language
        ? body.template_language
        : "es";

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Select at least one shipment to notify" },
        { status: 400 },
      );
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json(
        {
          error: `Send at most ${MAX_IDS} shipments per request; the list sends in batches.`,
        },
        { status: 400 },
      );
    }
    if (!templateName) {
      return NextResponse.json(
        { error: "'template_name' is required" },
        { status: 400 },
      );
    }

    // Re-read the rows server-side rather than trusting the phone or
    // status the browser sent: the tab may have been open since
    // before another teammate discarded or sent some of these.
    const { data, error } = await ctx.supabase
      .from("tracking_shipments")
      .select("id, tracking_code, greeting_name, recipient_name, phone, status")
      .eq("account_id", ctx.accountId)
      .in("id", ids);

    if (error) {
      console.error("[api/tracking/send] load error:", error);
      return NextResponse.json(
        { error: "Could not load the selected shipments" },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as SendableShipment[];
    const summary = await sendTrackingNotifications(
      ctx.supabase,
      ctx.accountId,
      rows,
      { templateName, templateLanguage },
    );

    // Nothing to flush today, but keeping the hook makes it obvious
    // where post-response work would go if delivery ever moves to a
    // queue.
    after(() => {});

    return NextResponse.json({ data: summary });
  } catch (err) {
    if (err instanceof TrackingSendError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return toErrorResponse(err);
  }
}
