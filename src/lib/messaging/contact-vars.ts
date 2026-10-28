// ============================================================
// Contact variables in automated messages (fork) — pure, testable.
//
// Upstream's engines only interpolate run state: flows know
// `{{vars.x}}` (answers captured by "Pedir dato"), automations also
// `{{message.text}}`. Nothing knew the contact, so a welcome like
// "¡Hola, {{nombre}}!" went out with the braces. This adds the
// contact's own fields, in Spanish (what the team types) and with an
// English `contact.` namespace:
//
//   {{nombre}}           {{contact.first_name}}   first word of the name
//   {{nombre_completo}}  {{contact.name}}         full name
//   {{telefono}}         {{contact.phone}}        phone as stored
//
// Tokens are case-insensitive and may have spaces inside the braces.
// A missing value renders as empty, matching how both engines treat a
// missing `vars` key — and the comma/space it leaves before "!" is
// tidied, so "¡Hola, {{nombre}}!" becomes "¡Hola!" rather than
// "¡Hola, !" when the contact has no name.
//
// Any other `{{…}}` is left untouched for the engine's own pass.
// ============================================================

import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

export interface ContactVars {
  name: string;
  first_name: string;
  phone: string;
}

export function toContactVars(
  contact: { name?: string | null; phone?: string | null } | null | undefined
): ContactVars | null {
  if (!contact) return null;
  const name = (contact.name ?? '').trim().replace(/\s+/g, ' ');
  return {
    name,
    first_name: name.split(' ')[0] ?? '',
    phone: (contact.phone ?? '').trim(),
  };
}

const TOKEN_FIELD: Record<string, keyof ContactVars> = {
  nombre: 'first_name',
  nombre_completo: 'name',
  telefono: 'phone',
  'contact.first_name': 'first_name',
  'contact.name': 'name',
  'contact.phone': 'phone',
};

const TOKEN_RE =
  /\{\{\s*(nombre_completo|nombre|telefono|contact\.first_name|contact\.name|contact\.phone)\s*\}\}/gi;

export function renderContactVars(
  text: string,
  contact: ContactVars | null
): string {
  if (!text) return text;
  let blanked = false;
  const out = text.replace(TOKEN_RE, (_, token: string) => {
    const value = contact?.[TOKEN_FIELD[token.toLowerCase()]] ?? '';
    if (!value) blanked = true;
    return value;
  });
  // "¡Hola, !" → "¡Hola!" only where a token actually came out empty.
  return blanked ? out.replace(/[ \t]*,[ \t]*(?=[!?.¡¿]|$)/gm, '') : out;
}

/**
 * Every customer-visible string of an interactive message, rendered.
 * Button and row ids are left alone: they are the routing keys the
 * reply is matched against and must reach Meta exactly as authored.
 */
export function renderInteractivePayload(
  payload: InteractiveMessagePayload,
  render: (text: string) => string
): InteractiveMessagePayload {
  const opt = (s: string | undefined) => (s === undefined ? s : render(s));
  if (payload.kind === 'buttons') {
    return {
      ...payload,
      body: render(payload.body),
      header: opt(payload.header),
      footer: opt(payload.footer),
      buttons: payload.buttons.map((b) => ({ ...b, title: render(b.title) })),
    };
  }
  return {
    ...payload,
    body: render(payload.body),
    header: opt(payload.header),
    footer: opt(payload.footer),
    button_label: render(payload.button_label),
    sections: payload.sections.map((s) => ({
      ...s,
      title: opt(s.title),
      rows: s.rows.map((r) => ({
        ...r,
        title: render(r.title),
        description: opt(r.description),
      })),
    })),
  };
}
