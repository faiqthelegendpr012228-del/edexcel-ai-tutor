// TEMPORARY: build a large test PDF (~target MB) with a realistic profile —
// ~120 real text pages plus a bulk non-page stream that pushes file size to
// the target without creating tens of thousands of parseable pages (mirrors
// an image-heavy textbook where most bytes are images, not text).
// Run: bun scripts/build-large-test-pdf.mjs [targetMB] [outPath]
import { writeFileSync, statSync } from "node:fs";

const targetMB = Number(process.argv[2] ?? 115);
const outPath = process.argv[3] ?? "/tmp/large-test.pdf";
const pageCount = Number(process.argv[4] ?? 120);
const target = targetMB * 1024 * 1024;

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const PAGE_TEXTS = [];
for (let p = 1; p <= pageCount; p++) {
  PAGE_TEXTS.push(
    `Topic ${p}: Cells are the basic structural and functional units of all living organisms. ` +
      `Organelles such as the nucleus, mitochondria and ribosomes carry out specialised roles within the cell, ` +
      `and each has a distinct structure related to its function. The nucleus contains chromatin and the nucleolus, ` +
      `mitochondria are the site of aerobic respiration producing ATP, and ribosomes synthesise proteins by translation. ` +
      `Cell membranes are phospholipid bilayers studded with intrinsic and extrinsic proteins that control what enters and leaves the cell, ` +
      `including via facilitated diffusion, active transport and endocytosis. Exam focus: be able to label diagrams and explain how ` +
      `structure relates to function for each organelle listed in the specification.`,
  );
}

const N = PAGE_TEXTS.length;
const objects = []; // 1-indexed via objects[i-1]
objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
objects[1] = `<< /Type /Pages /Kids [${PAGE_TEXTS.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${N} >>`;
const fontId = 3 + 2 * N;
const fillerId = fontId + 1;
PAGE_TEXTS.forEach((txt, i) => {
  const stream = `BT /F1 12 Tf 72 700 Td (${esc(txt)}) Tj ET`;
  objects[2 + i * 2] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  objects[3 + i * 2] =
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
});
objects[fontId - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

// Bulk non-page filler object (unreferenced by the page tree, like an
// embedded image XObject would bulk the file without adding parseable pages).
const headerApprox = 4096;
const xrefApprox = 2048;
const currentApprox = statSync("/dev/null").size; // 0 — just a marker
void currentApprox;
const usedEstimate =
  headerApprox +
  PAGE_TEXTS.reduce(
    (sum, t) => sum + Buffer.byteLength(t, "latin1") + 300,
    0,
  );
const fillerBytes = Math.max(0, target - usedEstimate - xrefApprox);
const fillerChunk = "A".repeat(1024 * 1024);
const wholeChunks = Math.floor(fillerBytes / (1024 * 1024));
const tail = fillerBytes - wholeChunks * 1024 * 1024;
const fillerBody = fillerChunk.repeat(wholeChunks) + (tail > 0 ? "A".repeat(tail) : "");
objects[fillerId - 1] =
  `<< /Length ${Buffer.byteLength(fillerBody, "latin1")} >>\nstream\n${fillerBody}\nendstream`;

let pdf = "%PDF-1.4\n";
const offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf, "latin1"));
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf, "latin1");
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= objects.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

writeFileSync(outPath, Buffer.from(pdf, "latin1"));
const written = statSync(outPath).size;
console.log(
  `wrote ${outPath}: ${(written / 1024 / 1024).toFixed(1)} MB, ${N} text pages + filler`,
);
