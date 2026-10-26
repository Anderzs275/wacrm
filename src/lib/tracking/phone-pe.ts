// ============================================================
// Peruvian mobile normalization for Olva tracking labels.
//
// Olva prints the recipient's number in national format with no
// country code ("930515808"), but every send path in this repo
// requires an explicit international `+` prefix — see
// `parseInternationalPhone` in lib/whatsapp/phone-utils and the
// reasoning in issue #586. Converting here, once, keeps that
// invariant intact instead of pushing a bare national number down
// the pipeline.
//
// The 8-digit floor in `isValidE164` is what makes this module
// necessary rather than merely convenient: a truncated label like
// "927 265 0" (7 digits) becomes "519272650" once the country code
// is prepended — 9 digits, so it PASSES that check and is delivered
// to whatever number it happens to spell. Length is therefore
// asserted against Peru's plan here, before the prefix is added.
// ============================================================

/** Peru's country calling code. */
export const PE_COUNTRY_CODE = '51'

/**
 * Peruvian mobile numbers are exactly 9 national digits and always
 * start with 9. Landlines (1 + 7 digits in Lima) are deliberately
 * NOT accepted: WhatsApp needs a mobile, and silently passing a
 * landline through would surface as an opaque Meta error at send
 * time rather than a reviewable row in the UI.
 */
const PE_MOBILE = /^9\d{8}$/

export type PhoneProblem =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'not_mobile'

export type NormalizedPhone =
  | { ok: true; e164: string; national: string }
  | { ok: false; problem: PhoneProblem; digits: string }

/**
 * Normalize a raw `TELEFONO/CELULAR:` value into the `+51XXXXXXXXX`
 * form the send path expects.
 *
 * Accepts the formatting noise Olva labels carry (spaces, dashes,
 * dots), and tolerates a number that already carries the country
 * code, since some labels are filled in by hand.
 */
export function normalizePeruPhone(raw: string | null | undefined): NormalizedPhone {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (!digits) return { ok: false, problem: 'empty', digits }

  // Already international: drop the country code and re-validate the
  // national part, so "+51 930515808" and "930515808" agree.
  const national = digits.startsWith(PE_COUNTRY_CODE) && digits.length > 9
    ? digits.slice(PE_COUNTRY_CODE.length)
    : digits

  if (PE_MOBILE.test(national)) {
    return { ok: true, e164: `+${PE_COUNTRY_CODE}${national}`, national }
  }

  if (national.length < 9) return { ok: false, problem: 'too_short', digits }
  if (national.length > 9) return { ok: false, problem: 'too_long', digits }
  return { ok: false, problem: 'not_mobile', digits }
}
