"use node";

import JSZip from "jszip";

export interface ExtractedPage {
  num: number;
  text: string;
}

export interface ExtractedDocument {
  text: string;
  pages: ExtractedPage[];
  pageCount: number;
}

export interface Chunk {
  content: string;
  page?: number;
  position: number;
}

export class UnsupportedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}

export async function extractText(
  type: string,
  bytes: ArrayBuffer,
  opts?: {
    pageConcurrency?: number;
    /** Called as pages complete so callers can persist live progress. */
    onProgress?: (donePages: number, totalPages: number) => void;
  },
): Promise<ExtractedDocument> {
  const buffer = Buffer.from(bytes);
  switch (type) {
    case "pdf":
      return extractPdf(buffer, opts?.pageConcurrency ?? 6, opts?.onProgress);
    case "docx":
      return extractDocx(buffer);
    case "pptx":
      return extractPptx(buffer);
    case "txt":
    case "md": {
      const text = buffer.toString("utf8");
      return { text, pages: [{ num: 1, text }], pageCount: 1 };
    }
    default:
      throw new UnsupportedFormatError(
        `We can't read "${type}" files yet. Upload a PDF, Word (.docx), PowerPoint (.pptx), .txt or .md file.`,
      );
  }
}

// PDF text extraction is provided by `pdfjs-dist` (legacy build), imported
// lazily so this module bundles cleanly. See extractPdf below.
async function extractPdf(
  buffer: Buffer,
  pageConcurrency: number,
  onProgress?: (donePages: number, totalPages: number) => void,
): Promise<ExtractedDocument> {
  const pdfjs = await importPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
  }).promise;
  try {
    const total = doc.numPages;
    const pages: ExtractedPage[] = new Array(total);

    const extractPage = async (n: number) => {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      const items = content.items as Array<{
        str?: string;
        hasEOL?: boolean;
      }>;
      for (const item of items) {
        if (typeof item.str === "string") text += item.str;
        if (item.hasEOL) text += "\n";
      }
      text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      pages[n - 1] = { num: n, text };
    };

    // Text extraction is CPU-bound per page, so pages are processed in
    // parallel slices — this is the single biggest wall-clock win for
    // multi-hundred-page textbooks. Results land in page order.
    let done = 0;
    for (let start = 1; start <= total; start += pageConcurrency) {
      const end = Math.min(start + pageConcurrency - 1, total);
      const group: Promise<void>[] = [];
      for (let n = start; n <= end; n++) {
        group.push(extractPage(n));
      }
      await Promise.all(group);
      done += end - start + 1;
      onProgress?.(done, total);
    }

    const parts: string[] = [];
    for (const p of pages) {
      if (p && p.text) parts.push(p.text);
    }
    return {
      text: parts.join("\n\n"),
      pages,
      pageCount: total,
    };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

interface PdfPage {
  getTextContent(): Promise<{
    items: Array<{ str?: string; hasEOL?: boolean }>;
  }>;
}

interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfjsModule {
  getDocument(params: { data: Uint8Array }): {
    promise: Promise<PdfDocument>;
  };
}

// Returns the pdfjs-dist legacy build (2.x — the latest pdf.js releases use
// `structuredClone` transfers the Convex runtime rejects, so we pin the
// proven legacy line).
//
// The package ships a UMD/CJS bundle. Under bundlers (tsx, vite) interop
// unwraps it, but the Convex Node runtime hands actions the raw namespace,
// where the API lives under `.default` — calling `mod.getDocument` directly
// threw "(intermediate value).getDocument is not a function". Handle both
// shapes and fail loudly here if neither matches, instead of a cryptic
// TypeError mid-extraction.
async function importPdfjs(): Promise<PdfjsModule> {
  const mod = (await import("pdfjs-dist/legacy/build/pdf.js")) as unknown as {
    getDocument?: unknown;
    default?: { getDocument?: unknown } | undefined;
  };
  const candidates: Array<{ getDocument?: unknown } | undefined> = [
    mod,
    mod.default,
  ];
  const impl = candidates.find(
    (c): c is PdfjsModule =>
      !!c && typeof c.getDocument === "function",
  );
  if (!impl) {
    throw new Error(
      "The PDF engine failed to load (unexpected pdfjs-dist module shape). Hit Retry — if this keeps happening, the pdfjs-dist version needs checking.",
    );
  }
  return impl;
}

async function extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/document.xml");
  if (!file) {
    throw new UnsupportedFormatError(
      "This doesn't look like a valid .docx file (missing document.xml).",
    );
  }
  const xml = await file.async("string");
  const paragraphs: string[] = [];
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(xml))) {
    const text = extractTagTexts(m[1], "w:t").join("");
    if (text.trim()) paragraphs.push(text.trim());
  }
  const text = paragraphs.join("\n\n");
  return { text, pages: [{ num: 1, text }], pageCount: 1 };
}

async function extractPptx(buffer: Buffer): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)![1]);
      const nb = Number(b.match(/slide(\d+)\.xml/)![1]);
      return na - nb;
    });
  if (slideNames.length === 0) {
    throw new UnsupportedFormatError(
      "This doesn't look like a valid .pptx file (no slides found).",
    );
  }
  const pages: ExtractedPage[] = [];
  for (const name of slideNames) {
    const xml = await zip.file(name)!.async("string");
    const text = extractTagTexts(xml, "a:t").join(" ").trim();
    pages.push({ num: pages.length + 1, text });
  }
  const text = pages
    .map((p) => `--- Slide ${p.num} ---\n${p.text}`)
    .join("\n\n");
  return { text, pages, pageCount: pages.length };
}

function extractTagTexts(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    out.push(decodeXmlEntities(m[1]));
  }
  return out;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Split a document into overlapping chunks of roughly `targetSize` characters,
 * keeping the page number of where each chunk starts so answers can cite it.
 */
export function chunkDocument(
  doc: ExtractedDocument,
  targetSize = 1500,
  overlap = 180,
): Chunk[] {
  const chunks: Chunk[] = [];
  let current = "";
  let currentPage: number | undefined;
  let position = 0;

  const push = (text: string, page: number | undefined) => {
    const trimmed = text.trim();
    if (trimmed) {
      chunks.push({ content: trimmed, page, position: position++ });
    }
  };

  const splitOversized = (pageNum: number | undefined) => {
    while (current.length > targetSize) {
      let cut = current.lastIndexOf(". ", targetSize);
      if (cut < targetSize * 0.5) cut = current.lastIndexOf(" ", targetSize);
      if (cut <= 0) cut = targetSize;
      push(current.slice(0, cut + 1), pageNum);
      current = current.slice(cut + 1).trimStart();
    }
  };

  for (const page of doc.pages) {
    const paragraphs = page.text
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const para of paragraphs) {
      if ((current + para).length <= targetSize) {
        current = current ? `${current}\n\n${para}` : para;
        if (currentPage === undefined) currentPage = page.num;
        continue;
      }
      // Current buffer is full: flush it, then carry the tail as overlap.
      push(current, currentPage);
      const tail = current.slice(-overlap).trimStart();
      current = tail ? `${tail}\n\n${para}` : para;
      currentPage = page.num;
      splitOversized(page.num);
    }
  }
  push(current, currentPage);
  return chunks;
}

export function normalizeExtractedText(text: string): string {
  return text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
}
