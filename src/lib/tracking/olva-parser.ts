// ============================================================
// Olva Courier label parser — pure, no I/O, no DOM.
//
// Olva's "rotulo" PDF prints two shipping labels per page. Each label
// leads with its tracking code and then runs a flat list of
// `CAMPO: valor` lines:
//
//   OLVA  LIMA   TRACKING 2618673-26   (ubigeo)140101
//   ENVIA: FOODMOOD S.A.C.
//   RUC/DNI: 20606553936
//   TELEFONO/CELULAR: 926392195      <- the SENDER's number
//   RECIBE: BRAULIO LOPEZ
//   RUC/DNI: 70575531
//   TELEFONO/CELULAR: 903147422      <- the RECIPIENT's number
//   DIRECCION: ...                    (may wrap over several lines)
//   REFERENCIA: ...                   (may wrap over several lines)
//   N° REGISTRO: 202600704749 (1/71)
//   FECHA WEB: 28/09/26
//
// Three properties of that shape drive the implementation:
//
//   1. The tracking code is the label's HEADER, not its footer. That
//      is what decides where one label ends and the next begins:
//      splitting on `ENVIA:` instead puts each code in the block
//      BEFORE the label it belongs to, so the first label has no code
//      at all and every other row is captioned with its neighbour's.
//      Blocks are therefore cut at the code when the code leads, and
//      at `ENVIA:` only when a document turns out to be ordered the
//      other way.
//
//   2. `TELEFONO/CELULAR:` appears TWICE per label. The first is the
//      shipper's own number — identical on all 71 labels. Taking the
//      first match would message yourself, once per row, and look
//      like a working import. The recipient's number is the one that
//      follows `RECIBE:`, so the scan is anchored there.
//
//   3. Address and reference fields wrap onto unlabelled lines. The
//      parser therefore never assumes a fixed line offset; it locates
//      each field by its label.
//
// Anything that doesn't yield both a tracking code and a recipient is
// returned as a `TrackingParseIssue` rather than dropped, so the UI
// can show what it could not read instead of silently shipping a
// shorter list than the PDF contained.
// ============================================================

import { normalizePeruPhone, type PhoneProblem } from "./phone-pe";

/** A label the parser could read end to end. */
export interface ParsedShipment {
  /** Olva tracking code, e.g. "2618673-26". Unique per shipment. */
  trackingCode: string;
  /** `RECIBE:` verbatim, e.g. "JORGE SANTILLAN ROJAS". */
  recipientName: string;
  /** Greeting-friendly first name, e.g. "Jorge". */
  greetingName: string;
  /** Raw `TELEFONO/CELULAR:` text, kept for display when invalid. */
  rawPhone: string;
  /** `+51XXXXXXXXX`, or null when the raw value isn't a PE mobile. */
  e164: string | null;
  /** Why `e164` is null. Null when the phone is fine. */
  phoneProblem: PhoneProblem | null;
  /** Position on the label, e.g. 1 for "(1/71)". */
  sequence: number | null;
  /** Olva's batch id, e.g. "202600704749". */
  registro: string | null;
}

/**
 * Something the parser could not turn into exactly one clean row.
 *
 * `merged` is not a failure to read — it is a failure to SPLIT, and
 * it is the dangerous one: the block yielded a valid-looking row, so
 * without this issue the extra labels inside it vanish with no error
 * at all and the operator just gets a shorter list than the PDF.
 */
export interface TrackingParseIssue {
  /** 1-based index of the block within the document. */
  blockIndex: number;
  reason: "no_tracking" | "no_recipient" | "merged";
  /** First ~200 chars of the block, to show the operator. */
  excerpt: string;
  /** For `merged`: the codes found in the block beyond the first. */
  lostCodes?: string[];
}

export interface OlvaParseResult {
  shipments: ParsedShipment[];
  issues: TrackingParseIssue[];
  /** Total declared by "(n/TOTAL)", when the labels agree on one. */
  declaredTotal: number | null;
  /** How many `ENVIA:` blocks the split produced, read or not. */
  blockCount: number;
}

/** Matches "TRACKING 2618673-26" anywhere in a block. */
const TRACKING_RE = /TRACKING\s+([0-9]{3,}-[0-9]{2,})/i;
/** Same, global — used to detect a block that swallowed two labels. */
const TRACKING_RE_G = /TRACKING\s+([0-9]{3,}-[0-9]{2,})/gi;
/** Matches the "(1/71)" counter that follows N° REGISTRO. */
const SEQUENCE_RE = /\(\s*(\d+)\s*\/\s*(\d+)\s*\)/;
/** Matches the batch id in "N° REGISTRO: 202600704749". */
const REGISTRO_RE = /REGISTRO\s*:\s*(\d+)/i;

/**
 * Title-case a single name token, preserving Spanish accents and Ñ.
 * "SANTILLAN" -> "Santillan", "danny" -> "Danny".
 */
function titleCaseToken(token: string): string {
  if (!token) return token;
  return (
    token[0].toLocaleUpperCase("es") + token.slice(1).toLocaleLowerCase("es")
  );
}

/**
 * Derive the name used in the message greeting.
 *
 * Olva labels are entered by customers and arrive in every shape:
 * ALL CAPS ("JORGE SANTILLAN ROJAS"), lowercase ("danny rodriguez"),
 * and padded with filler punctuation ("HUAMAN BARRIENTOS . ."). A
 * greeting is the most visible text in the whole message, so the
 * first token is cleaned and title-cased rather than interpolated
 * raw. Punctuation-only tokens are skipped so the fallback is a real
 * name, not a dot.
 */
export function toGreetingName(fullName: string): string {
  const tokens = fullName
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{M}'-]/gu, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  return titleCaseToken(tokens[0]);
}

/** Read `LABEL: value` from a block, returning the value or "". */
function fieldAfter(
  lines: string[],
  startIndex: number,
  label: string,
): string {
  const re = new RegExp("^\\s*" + label + "\\s*:\\s*(.*)$", "i");
  for (let i = startIndex; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) return m[1].trim();
  }
  return "";
}

/** Index of the line whose label matches, or -1. */
function lineIndexOf(lines: string[], label: string): number {
  const re = new RegExp("^\\s*" + label + "\\s*:", "i");
  return lines.findIndex((l) => re.test(l));
}

/**
 * Cut the document into one block per label.
 *
 * Which anchor delimits a label is a property of the document, not a
 * constant: on the rotulos Olva prints today the tracking code is the
 * label's header, so cutting at `ENVIA:` leaves every code stranded
 * in the previous block - the first label reports "no tracking" and
 * each later one gets captioned with its neighbour's code, which is
 * worse than failing outright. The anchor is therefore chosen from
 * which of the two actually comes first in the text, so a document
 * that really does print the code last still parses.
 */
function splitLabels(normalized: string): string[] {
  const firstCode = normalized.search(TRACKING_RE);
  const firstEnvia = normalized.search(/^[ \t]*ENVIA[ \t]*:/m);

  const codeLeads =
    firstCode !== -1 && (firstEnvia === -1 || firstCode < firstEnvia);

  if (codeLeads) {
    // Anything before the first code is page furniture and is
    // dropped; the "OLVA / LIMA" that visually precedes each header
    // trails the previous block, where it is inert.
    return normalized
      .split(/(?=TRACKING\s+[0-9]{3,}-[0-9]{2,})/i)
      .map((b) => b.trim())
      .filter((b) => /^TRACKING\s/i.test(b));
  }

  return normalized
    .split(/(?=^[ \t]*ENVIA[ \t]*:)/m)
    .map((b) => b.trim())
    .filter((b) => /^ENVIA\s*:/i.test(b));
}

/**
 * Parse the full text layer of an Olva label PDF.
 *
 * `text` is the concatenation of every page's extracted text, in page
 * order, with newlines preserved.
 */
export function parseOlvaLabels(text: string): OlvaParseResult {
  const normalized = text.replace(/\r\n?/g, "\n");

  const blocks = splitLabels(normalized);

  const shipments: ParsedShipment[] = [];
  const issues: TrackingParseIssue[] = [];
  const totals = new Set<number>();

  blocks.forEach((block, i) => {
    const lines = block.split("\n");

    const trackingMatch = block.match(TRACKING_RE);
    if (!trackingMatch) {
      issues.push({
        blockIndex: i + 1,
        reason: "no_tracking",
        excerpt: block.slice(0, 200),
      });
      return;
    }

    const recibeIndex = lineIndexOf(lines, "RECIBE");
    if (recibeIndex === -1) {
      issues.push({
        blockIndex: i + 1,
        reason: "no_recipient",
        excerpt: block.slice(0, 200),
      });
      return;
    }

    const recipientName = fieldAfter(lines, recibeIndex, "RECIBE");
    // Anchored AFTER `RECIBE:` so the shipper's own number — the
    // first TELEFONO/CELULAR on every label — can never win.
    const rawPhone = fieldAfter(lines, recibeIndex + 1, "TELEFONO/CELULAR");

    const phone = normalizePeruPhone(rawPhone);
    const sequenceMatch = block.match(SEQUENCE_RE);
    if (sequenceMatch) totals.add(Number(sequenceMatch[2]));
    const registroMatch = block.match(REGISTRO_RE);

    // A block is one label, so a second code OR a second `RECIBE:`
    // inside it means the split failed and the extra labels are about
    // to vanish with no error at all. Which of the two counts trips
    // depends on the anchor: cutting at the code guarantees one code
    // per block, cutting at `ENVIA:` guarantees one recipient.
    // Checking both keeps the detection honest under either.
    const allCodes = [...block.matchAll(TRACKING_RE_G)].map((m) => m[1]);
    const recipientCount = lines.filter((l) =>
      /^\s*RECIBE\s*:/i.test(l),
    ).length;
    if (allCodes.length > 1 || recipientCount > 1) {
      issues.push({
        blockIndex: i + 1,
        reason: "merged",
        excerpt: block.slice(0, 200),
        lostCodes: allCodes.slice(1),
      });
    }

    shipments.push({
      trackingCode: trackingMatch[1],
      recipientName,
      greetingName: toGreetingName(recipientName),
      rawPhone,
      e164: phone.ok ? phone.e164 : null,
      phoneProblem: phone.ok ? null : phone.problem,
      sequence: sequenceMatch ? Number(sequenceMatch[1]) : null,
      registro: registroMatch ? registroMatch[1] : null,
    });
  });

  return {
    shipments,
    issues,
    declaredTotal: totals.size === 1 ? [...totals][0] : null,
    blockCount: blocks.length,
  };
}

/**
 * Group shipments by recipient phone to surface repeat customers.
 *
 * Two labels for one number are legitimate — the same person ordered
 * twice and gets two parcels, each with its own tracking code. They
 * are NOT merged: the operator asked for one message per order, with
 * a warning. Returns the set of `e164` values that appear more than
 * once so the UI can flag every row involved.
 */
export function duplicatePhones(shipments: ParsedShipment[]): Set<string> {
  const seen = new Map<string, number>();
  for (const s of shipments) {
    if (!s.e164) continue;
    seen.set(s.e164, (seen.get(s.e164) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([p]) => p));
}
