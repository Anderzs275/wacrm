// ============================================================
// Browser-side PDF text extraction for the Tracking import.
//
// The label PDF is read in the operator's browser and never uploaded.
// That is a privacy decision, not a performance one: an Olva batch
// carries every recipient's full name, national id, home address and
// phone number for 71 people. Parsing client-side means only the
// three fields the feature actually needs (name, phone, tracking
// code) cross the network, and there is no PDF at rest to secure,
// back up or eventually leak.
//
// This module is the only place that touches pdf.js. Everything
// downstream works on the plain string it returns, which is what
// keeps `olva-parser.ts` pure and unit-testable without a DOM.
// ============================================================

import type { TextItem } from "pdfjs-dist/types/src/display/api";

/** Raised when the file cannot be opened or holds no text layer. */
export class PdfTextError extends Error {
  constructor(
    message: string,
    readonly kind: "unreadable" | "no_text_layer",
  ) {
    super(message);
    this.name = "PdfTextError";
  }
}

/**
 * pdf.js ships its worker as a separate module. Loading it lazily,
 * inside the extract call, keeps ~1MB of parser out of the initial
 * bundle for every page that merely links to Tracking.
 */
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  // Resolved through the bundler rather than a CDN so the app keeps
  // working offline and the worker version can never drift from the
  // library version — a mismatch fails with an opaque
  // "API version does not match Worker version".
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}

/** True for the text items pdf.js emits (vs. marked-content markers). */
function isTextItem(item: unknown): item is TextItem {
  return typeof (item as TextItem)?.str === "string";
}

export interface ExtractProgress {
  page: number;
  pages: number;
}

/**
 * Extract the text layer of a PDF as newline-separated lines.
 *
 * Line breaks matter: `parseOlvaLabels` locates fields by their
 * `CAMPO:` prefix at the start of a line, and Olva labels wrap
 * addresses across lines. pdf.js marks the end of a visual line with
 * `hasEOL`, which is what this relies on rather than re-deriving
 * lines from glyph coordinates.
 *
 * Pages are joined with a blank line so a label can never appear to
 * run into the next page's first field.
 */
export async function extractPdfText(
  file: File | ArrayBuffer,
  onProgress?: (p: ExtractProgress) => void,
): Promise<string> {
  const pdfjs = await loadPdfJs();

  const data =
    file instanceof ArrayBuffer ? file : new Uint8Array(await file.arrayBuffer());

  // The teardown method lives on the loading task, not on the
  // document proxy, so the task is what has to stay in scope for the
  // `finally` below.
  const loadingTask = pdfjs.getDocument({ data });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (cause) {
    throw new PdfTextError(
      cause instanceof Error ? cause.message : "Could not open the PDF",
      "unreadable",
    );
  }

  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      onProgress?.({ page: pageNumber, pages: doc.numPages });

      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();

      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!isTextItem(item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line.trim());
          line = "";
        }
      }
      if (line.trim()) lines.push(line.trim());

      pages.push(lines.join("\n"));
      page.cleanup();
    }
  } finally {
    // Frees the worker even when a page throws mid-extraction.
    await loadingTask.destroy();
  }

  const text = pages.join("\n\n");

  // A scanned (image-only) PDF opens fine and yields nothing. Saying
  // so plainly beats handing the parser an empty string and reporting
  // "0 shipments found", which reads like the file was the wrong one.
  if (!text.trim()) {
    throw new PdfTextError(
      "This PDF has no text layer — it looks like a scan or a photo.",
      "no_text_layer",
    );
  }

  return text;
}
