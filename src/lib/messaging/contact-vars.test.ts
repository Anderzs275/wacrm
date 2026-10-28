import { describe, expect, it } from 'vitest';

import {
  renderContactVars,
  renderInteractivePayload,
  toContactVars,
} from './contact-vars';

const carlos = toContactVars({ name: ' Carlos  Polanco ', phone: '51920155032' });

describe('renderContactVars', () => {
  it('fills the Spanish tokens', () => {
    expect(renderContactVars('¡Hola, {{nombre}}! 👋', carlos)).toBe(
      '¡Hola, Carlos! 👋'
    );
    expect(
      renderContactVars('{{nombre_completo}} · {{telefono}}', carlos)
    ).toBe('Carlos Polanco · 51920155032');
  });

  it('accepts the contact. namespace, any case and inner spaces', () => {
    expect(
      renderContactVars('{{ Contact.First_Name }} / {{CONTACT.NAME}}', carlos)
    ).toBe('Carlos / Carlos Polanco');
  });

  it('drops the dangling comma when the name is missing', () => {
    const nameless = toContactVars({ name: null, phone: '519' });
    expect(renderContactVars('¡Hola, {{nombre}}! Bienvenido', nameless)).toBe(
      '¡Hola! Bienvenido'
    );
    expect(renderContactVars('Hola, {{nombre}}', null)).toBe('Hola');
  });

  it('leaves other placeholders for the engine', () => {
    expect(renderContactVars('{{vars.email}} {{message.text}}', carlos)).toBe(
      '{{vars.email}} {{message.text}}'
    );
  });

  it('does not touch commas when nothing came out empty', () => {
    expect(renderContactVars('Hola, {{nombre}}, ¿cómo estás?', carlos)).toBe(
      'Hola, Carlos, ¿cómo estás?'
    );
  });
});

describe('renderInteractivePayload', () => {
  const render = (s: string) => renderContactVars(s, carlos);

  it('renders visible list text but keeps ids', () => {
    const out = renderInteractivePayload(
      {
        kind: 'list',
        body: '¡Hola, {{nombre}}!',
        footer: 'Atendemos de 9 a 6',
        button_label: 'Menú',
        sections: [
          {
            title: 'Para {{nombre}}',
            rows: [{ id: 'row_{{nombre}}', title: 'Pedidos' }],
          },
        ],
      },
      render
    );
    expect(out).toMatchObject({
      body: '¡Hola, Carlos!',
      footer: 'Atendemos de 9 a 6',
      sections: [{ title: 'Para Carlos', rows: [{ id: 'row_{{nombre}}' }] }],
    });
  });

  it('renders button titles', () => {
    const out = renderInteractivePayload(
      {
        kind: 'buttons',
        body: 'Hola {{nombre}}',
        buttons: [{ id: 'a', title: 'Soy {{nombre}}' }],
      },
      render
    );
    expect(out).toMatchObject({
      body: 'Hola Carlos',
      buttons: [{ id: 'a', title: 'Soy Carlos' }],
    });
  });
});
