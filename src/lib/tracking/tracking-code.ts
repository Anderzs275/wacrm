// ============================================================
// What the customer types into Olva's tracker.
//
// Labels print the code as "2618673-26": the tracking number plus the
// two-digit issue year. Olva's form at tracking.olvaexpress.pe asks
// for the two separately — the year is a dropdown that defaults to
// the current one — and searching the full "2618673-26" finds
// nothing. So the message and its copy button carry only the number.
//
// The stored `tracking_code` keeps the suffix: numbers can repeat
// across years, and the (account_id, tracking_code) unique key is what
// stops a re-upload from re-sending.
// ============================================================

const YEAR_SUFFIX = /-\d{2}$/;

/** "2618673-26" → "2618673". Codes without a year suffix pass through. */
export function olvaLookupNumber(trackingCode: string): string {
  return trackingCode.trim().replace(YEAR_SUFFIX, "");
}
