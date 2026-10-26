// Fixtures are copied verbatim out of the text layer of a real
// `rotulo-202600704749.pdf` (71 labels, 36 pages), including the
// three defects that batch actually contained: a truncated phone, a
// customer with two parcels, and names typed in inconsistent case.
//
// Note the shape: `TRACKING <code>` is the label's HEADER, above
// `ENVIA:`. An earlier revision of these fixtures put it last, which
// is why the parser shipped splitting on `ENVIA:` and stranded every
// code in the wrong block. The layout is load-bearing, so it is
// reproduced here exactly as the PDF emits it.

import { describe, expect, it } from "vitest";

import {
  duplicatePhones,
  parseOlvaLabels,
  toGreetingName,
} from "./olva-parser";

/** Label 1/71 — the happy path. */
const LABEL_1 = `OLVA
LIMA
TRACKING 2618673-26
(ubigeo)140101
ENVIA: FOODMOOD S.A.C.
RUC/DNI: 20606553936
TELEFONO/CELULAR: 926392195
RECIBE: JORGE SANTILLAN ROJAS
RUC/DNI: 70575531
TELEFONO/CELULAR: 930515808
DIRECCION: Calle Daniel Alcides carrion 135 - oficina 402
CHICLAYO - CHICLAYO - LAMBAYEQUE
REFERENCIA: Al Costado de la Clinica Millenium
N° REGISTRO: 202600704749 (1/71)
FECHA WEB: 28/09/26`;

/** Label 12/71 — lowercase name, first of two parcels for one phone. */
const LABEL_12 = `OLVA
LIMA
TRACKING 2618684-26
(ubigeo)150119
ENVIA: FOODMOOD S.A.C.
RUC/DNI: 20606553936
TELEFONO/CELULAR: 926392195
RECIBE: danny rodriguez
RUC/DNI: 1071838650
TELEFONO/CELULAR: 941459865
DIRECCION: mz d lt 18 los pulpos lurín
LURIN - LIMA - LIMA
REFERENCIA: Frente a la pollería norkys km 41.5 José
N° REGISTRO: 202600704749 (12/71)
FECHA WEB: 28/09/26`;

/** Label 32/71 — same customer, same phone, a different parcel. */
const LABEL_32 = `OLVA
LIMA
TRACKING 2618704-26
(ubigeo)150119
ENVIA: FOODMOOD S.A.C.
RUC/DNI: 20606553936
TELEFONO/CELULAR: 926392195
RECIBE: danny rodriguez
RUC/DNI: 1071838650
TELEFONO/CELULAR: 941459865
DIRECCION: mz d lt 18 los pulpos lurín
LURIN - LIMA - LIMA
REFERENCIA: Frente a la pollería norkys km 41.5 José Olaya
balandra
N° REGISTRO: 202600704749 (32/71)
FECHA WEB: 28/09/26`;

/** Label 48/71 — the phone is truncated to 7 digits in the source. */
const LABEL_48 = `OLVA
LIMA
TRACKING 2618720-26
(ubigeo)060808
ENVIA: FOODMOOD S.A.C.
RUC/DNI: 20606553936
TELEFONO/CELULAR: 926392195
RECIBE: LILIANA HOYOS HERRERA
RUC/DNI: 27720903
TELEFONO/CELULAR: 927 265 0
DIRECCION: JR. CIRCUNVALACIÓN S-N CENT. PUCARÁ
PUCARA - JAEN - CAJAMARCA
REFERENCIA: Pucará, Jaén
N° REGISTRO: 202600704749 (48/71)
FECHA WEB: 28/09/26`;

/** Label 68/71 — the name is padded with filler punctuation. */
const LABEL_68 = `OLVA
LIMA
TRACKING 2618740-26
(ubigeo)050116
ENVIA: FOODMOOD S.A.C.
RUC/DNI: 20606553936
TELEFONO/CELULAR: 926392195
RECIBE: HUAMAN BARRIENTOS . .
RUC/DNI: 45979430
TELEFONO/CELULAR: 945444928
DIRECCION: AV. ARENALES 478
ANDRES AVELINO CACERES - HUAMANGA - AYACUCHO
REFERENCIA: Entrada inia
N° REGISTRO: 202600704749 (68/71)
FECHA WEB: 28/09/26`;

/** Label 11/71 — address and reference both wrap over three lines. */
const LABEL_11_WRAPPED = `OLVA
LIMA
TRACKING 2618683-26
(ubigeo)110101
ENVIA: FOODMOOD S.A.C.
RUC/DNI: 20606553936
TELEFONO/CELULAR: 926392195
RECIBE: HERALDO ELIAS HUAMAN ESCATE
RUC/DNI: 70345417
TELEFONO/CELULAR: 996418939
DIRECCION: ICA - CA GUATEMALA NRO 161
URBANIZACION SAN FRANCISCO, ICA (A ESPALDAS DE
OESHLE)
ICA - ICA - ICA
REFERENCIA: OFICINA ICA - CA GUATEMALA NRO 161
URBANIZACION SAN FRANCISCO, ICA (A ESPALDAS DE
OESHLE)
N° REGISTRO: 202600704749 (11/71)
FECHA WEB: 28/09/26`;

describe("parseOlvaLabels", () => {
  it("reads tracking, recipient and phone from a label", () => {
    const { shipments, issues } = parseOlvaLabels(LABEL_1);

    expect(issues).toEqual([]);
    expect(shipments).toHaveLength(1);
    expect(shipments[0]).toMatchObject({
      trackingCode: "2618673-26",
      recipientName: "JORGE SANTILLAN ROJAS",
      greetingName: "Jorge",
      e164: "+51930515808",
      phoneProblem: null,
      sequence: 1,
      registro: "202600704749",
    });
  });

  // The shipper's own number leads every label. Picking the first
  // TELEFONO/CELULAR would send all 71 messages to FOODMOOD itself.
  it("takes the recipient's phone, never the shipper's", () => {
    const { shipments } = parseOlvaLabels(LABEL_1);
    expect(shipments[0].e164).toBe("+51930515808");
    expect(shipments[0].e164).not.toBe("+51926392195");
  });

  it("splits a multi-label document into one row per label", () => {
    const { shipments, declaredTotal } = parseOlvaLabels(
      [LABEL_1, LABEL_12, LABEL_32].join("\n"),
    );

    expect(shipments.map((s) => s.trackingCode)).toEqual([
      "2618673-26",
      "2618684-26",
      "2618704-26",
    ]);
    expect(declaredTotal).toBe(71);
  });

  // Fixed line offsets would break here: DIRECCION and REFERENCIA
  // each wrap, pushing the tracking line five rows further down.
  it("handles address and reference fields that wrap", () => {
    const { shipments, issues } = parseOlvaLabels(LABEL_11_WRAPPED);

    expect(issues).toEqual([]);
    expect(shipments[0]).toMatchObject({
      trackingCode: "2618683-26",
      recipientName: "HERALDO ELIAS HUAMAN ESCATE",
      e164: "+51996418939",
    });
  });

  // "927 265 0" is 7 digits. Prefixing +51 yields 9, which clears the
  // repo's 8-digit E.164 floor — so the length must be rejected here
  // or the row silently ships to a number that isn't the customer's.
  it("rejects a truncated phone instead of prefixing it", () => {
    const { shipments } = parseOlvaLabels(LABEL_48);

    expect(shipments[0]).toMatchObject({
      trackingCode: "2618720-26",
      recipientName: "LILIANA HOYOS HERRERA",
      rawPhone: "927 265 0",
      e164: null,
      phoneProblem: "too_short",
    });
  });

  it("keeps both parcels when one customer ordered twice", () => {
    const { shipments } = parseOlvaLabels([LABEL_12, LABEL_32].join("\n"));

    expect(shipments).toHaveLength(2);
    expect(shipments.map((s) => s.trackingCode)).toEqual([
      "2618684-26",
      "2618704-26",
    ]);
    expect(new Set(shipments.map((s) => s.e164))).toEqual(
      new Set(["+51941459865"]),
    );
  });

  it("reports a block it cannot read rather than dropping it", () => {
    const broken = `ENVIA: FOODMOOD S.A.C.
RUC/DNI: 20606553936
TELEFONO/CELULAR: 926392195
RECIBE: SIN CODIGO
TELEFONO/CELULAR: 930515808
FECHA WEB: 28/09/26`;

    const { shipments, issues } = parseOlvaLabels(broken);

    expect(shipments).toEqual([]);
    expect(issues).toEqual([
      expect.objectContaining({ blockIndex: 1, reason: "no_tracking" }),
    ]);
  });

  // The silent-halving case. Cutting at the code header is immune to
  // the next label being glued onto the previous line, so the way a
  // block can still swallow a neighbour is a header that did not come
  // through at all: the two labels then share one block, the first is
  // read and the second disappears without an error of its own.
  it("flags a block that swallowed a second label", () => {
    // Drop the four header lines (OLVA / LIMA / TRACKING / ubigeo)
    // so label 12 arrives with no boundary of its own.
    const headerless = LABEL_12.split("\n").slice(4).join("\n");
    const { shipments, issues } = parseOlvaLabels(
      [LABEL_1, headerless].join("\n"),
    );

    expect(shipments).toHaveLength(1);
    expect(shipments[0].recipientName).toBe("JORGE SANTILLAN ROJAS");
    expect(issues).toEqual([
      expect.objectContaining({ blockIndex: 1, reason: "merged" }),
    ]);
  });

  // Two labels per page occasionally come out with the next header
  // glued to the previous label's last line. The header split is not
  // line-anchored precisely so this stays a clean two-row read.
  it("splits labels even when the next header is glued on", () => {
    const glued = [LABEL_1, LABEL_12]
      .join("\n")
      .replace(
        "28/09/26\nOLVA\nLIMA\nTRACKING",
        "28/09/26OLVA LIMA TRACKING",
      );
    const { shipments, issues } = parseOlvaLabels(glued);

    expect(issues).toEqual([]);
    expect(shipments.map((x) => x.trackingCode)).toEqual([
      "2618673-26",
      "2618684-26",
    ]);
  });

  it("ignores page furniture before the first label", () => {
    const { shipments } = parseOlvaLabels("OLVA\nLIMA\n\n" + LABEL_1);
    expect(shipments).toHaveLength(1);
  });

  it("returns nothing for a document with no labels", () => {
    expect(parseOlvaLabels("")).toEqual({
      shipments: [],
      issues: [],
      declaredTotal: null,
      blockCount: 0,
    });
  });
});

describe("toGreetingName", () => {
  it("title-cases a shouted name", () => {
    expect(toGreetingName("JORGE SANTILLAN ROJAS")).toBe("Jorge");
  });

  it("title-cases a lowercase name", () => {
    expect(toGreetingName("danny rodriguez")).toBe("Danny");
  });

  // "HUAMAN BARRIENTOS . ." must not greet the customer as ".".
  it("skips filler punctuation", () => {
    expect(toGreetingName("HUAMAN BARRIENTOS . .")).toBe("Huaman");
    expect(toGreetingName(". .")).toBe("");
  });

  it("preserves Spanish letters", () => {
    expect(toGreetingName("LEONARDO VARGAS MAGARIÑO")).toBe("Leonardo");
    expect(toGreetingName("ÁNGEL GARCES")).toBe("Ángel");
    expect(toGreetingName("KLEIDY-ANGELY CHAMBI")).toBe("Kleidy-angely");
  });

  it("is empty for an empty name", () => {
    expect(toGreetingName("")).toBe("");
  });
});

describe("duplicatePhones", () => {
  it("flags a phone that appears on more than one label", () => {
    const { shipments } = parseOlvaLabels(
      [LABEL_1, LABEL_12, LABEL_32].join("\n"),
    );

    expect(duplicatePhones(shipments)).toEqual(new Set(["+51941459865"]));
  });

  it("ignores rows whose phone could not be normalized", () => {
    const { shipments } = parseOlvaLabels([LABEL_48, LABEL_48].join("\n"));
    expect(duplicatePhones(shipments)).toEqual(new Set());
  });

  it("is empty when every phone is unique", () => {
    const { shipments } = parseOlvaLabels([LABEL_1, LABEL_68].join("\n"));
    expect(duplicatePhones(shipments)).toEqual(new Set());
  });
});
