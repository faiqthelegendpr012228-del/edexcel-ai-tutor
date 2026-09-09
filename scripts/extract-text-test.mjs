// Temporary repro/verification for the "(intermediate value).getDocument is
// not a function" bug. Builds a real 3-page PDF, then runs the app's actual
// extractText (same Node runtime as the Convex action) against it.
// Run: bunx tsx scripts/extract-text-test.mjs
import { extractText, chunkDocument } from "../src/convex/lib/extract.ts";

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Build a minimal but valid multi-page PDF with visible text. */
function buildPdf(pageTexts) {
  const byteLen = (s) => Buffer.byteLength(s, "latin1");
  const N = pageTexts.length;
  const objects = []; // 1-indexed objects[i-1]
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pageTexts.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects[1] = `<< /Type /Pages /Kids [${kids}] /Count ${N} >>`;
  const fontId = 3 + 2 * N;
  pageTexts.forEach((txt, i) => {
    const contentId = 4 + i * 2;
    objects[2 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    const stream = `BT /F1 12 Tf 72 720 Td (${esc(txt)}) Tj ET`;
    objects[3 + i * 2] =
      `<< /Length ${byteLen(stream)} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId - 1] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(byteLen(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = byteLen(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const pages = [
  "Photosynthesis is the process by which plants convert light energy into chemical energy.",
  "Respiration releases energy from glucose in all living cells.",
  "Enzymes are biological catalysts that speed up reactions without being used up.",
];

const pdfBytes = buildPdf(pages);
const arrayBuffer = pdfBytes.buffer.slice(
  pdfBytes.byteOffset,
  pdfBytes.byteOffset + pdfBytes.byteLength,
);

console.log(`[test] Built ${pages.length}-page PDF (${pdfBytes.length} bytes)`);
console.log("[test] Calling extractText('pdf', ...) with onProgress...\n");

try {
  const progress = [];
  const doc = await extractText("pdf", arrayBuffer, {
    pageConcurrency: 2,
    onProgress: (done, total) => progress.push(`${done}/${total}`),
  });
  console.log("[test] SUCCESS");
  console.log("  pageCount:", doc.pageCount);
  console.log("  progress calls:", progress.join(" "));
  console.log("  page 1 text:", JSON.stringify(doc.pages[0]?.text?.slice(0, 60)));
  const ok = pages.every((p, i) => (doc.pages[i]?.text ?? "").includes(p.slice(0, 30)));
  console.log("  all page texts extracted correctly:", ok);
  const chunks = chunkDocument(doc);
  console.log("  chunks produced:", chunks.length);
  process.exit(ok && doc.pageCount === 3 ? 0 : 1);
} catch (err) {
  console.log("[test] FAILED with error:");
  console.log("  ", err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n   ") : err);
  process.exit(2);
}
