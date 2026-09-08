#!/usr/bin/env node
/**
 * Gemini File Search Store management for the Edexcel knowledge base.
 *
 * Usage (set GEMINI_API_KEY in the environment or the Keys panel first):
 *
 *   bun scripts/gemini-file-search.mjs create-store
 *       Create the "edexcel-knowledge-base" store (idempotent — reuses it
 *       if it already exists) and print its resource name.
 *
 *   bun scripts/gemini-file-search.mjs upload ./specs/biology.pdf "Biology Spec"
 *   bun scripts/gemini-file-search.mjs upload ./papers/maths-paper-1.pdf
 *       Upload a PDF/DOCX/TXT/MD file into the store. Gemini chunks, embeds
 *       and indexes it automatically. Optional second arg sets the display
 *       name shown in citations. Waits for indexing to finish.
 *
 *   bun scripts/gemini-file-search.mjs list
 *       List stores and the documents inside the knowledge base.
 *
 *   bun scripts/gemini-file-search.mjs delete-store <name>
 *       Delete a store (force) — e.g. to rebuild from scratch.
 */

import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

const STORE_DISPLAY_NAME = "edexcel-knowledge-base";

function client() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error(
      "GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/api-keys and export it:\n  export GEMINI_API_KEY=...",
    );
    process.exit(1);
  }
  return new GoogleGenAI({ apiKey: key });
}

function mimeFor(ext) {
  switch (ext.toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    default:
      return "application/octet-stream";
  }
}

async function findStoreByDisplayName(ai) {
  const pager = await ai.fileSearchStores.list({ config: { pageSize: 50 } });
  for await (const store of pager) {
    if (store.displayName === STORE_DISPLAY_NAME && store.name) return store.name;
  }
  return null;
}

async function waitForOperation(ai, operation, label) {
  let op = operation;
  while (!op.done) {
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 3000));
    op = await ai.operations.get({ operation: op });
  }
  console.log(`\n${label} complete.`);
  return op;
}

async function createStore() {
  const ai = client();
  const existing = await findStoreByDisplayName(ai);
  if (existing) {
    console.log(`Store already exists: ${existing}`);
    console.log(
      "Optional: pin it in the deployment with GEMINI_FILE_SEARCH_STORE=" +
        existing,
    );
    return;
  }
  const store = await ai.fileSearchStores.create({
    config: {
      displayName: STORE_DISPLAY_NAME,
      embeddingModel: "models/gemini-embedding-001",
    },
  });
  console.log(`Created store: ${store.name}`);
  console.log(
    `Optional: pin it in the deployment with GEMINI_FILE_SEARCH_STORE=${store.name}`,
  );
  console.log("\nNext: upload documents, e.g.");
  console.log(
    `  bun scripts/gemini-file-search.mjs upload ./biology-spec.pdf "Edexcel Biology Specification"`,
  );
}

async function upload(fileArg, displayNameArg) {
  if (!fileArg) {
    console.error("Usage: bun scripts/gemini-file-search.mjs upload <file> [display name]");
    process.exit(1);
  }
  const ai = client();
  let storeName = await findStoreByDisplayName(ai);
  if (!storeName) {
    console.log("Store not found — creating it first…");
    const store = await ai.fileSearchStores.create({
      config: {
        displayName: STORE_DISPLAY_NAME,
        embeddingModel: "models/gemini-embedding-001",
      },
    });
    storeName = store.name;
    console.log(`Created store: ${storeName}`);
  }

  const filePath = fileArg;
  const bytes = readFileSync(filePath);
  const displayName =
    displayNameArg ?? basename(filePath, extname(filePath)).replace(/[-_]+/g, " ");

  console.log(
    `Uploading ${basename(filePath)} (${(bytes.length / 1024 / 1024).toFixed(1)} MB) as "${displayName}"…`,
  );
  const operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: new Blob([new Uint8Array(bytes)], { type: mimeFor(extname(filePath)) }),
    fileSearchStoreName: storeName,
    config: {
      displayName,
      customMetadata: [{ key: "uploaded_via", stringValue: "setup-script" }],
    },
  });
  await waitForOperation(ai, operation, "Indexing");
  console.log(`Done: ${displayName} is searchable in ${storeName}`);
}

async function list() {
  const ai = client();
  const pager = await ai.fileSearchStores.list({ config: { pageSize: 50 } });
  let any = false;
  for await (const store of pager) {
    any = true;
    console.log(`Store: ${store.name}  (${store.displayName ?? "unnamed"})`);
    if (store.displayName === STORE_DISPLAY_NAME) {
      const docs = await ai.fileSearchStores.documents.list({
        parent: store.name,
        config: { pageSize: 50 },
      });
      for await (const doc of docs) {
        console.log(`   - ${doc.displayName ?? doc.name}`);
      }
    }
  }
  if (!any) console.log("No File Search stores yet. Run create-store first.");
}

async function deleteStore(name) {
  if (!name) {
    console.error("Usage: bun scripts/gemini-file-search.mjs delete-store <store resource name>");
    process.exit(1);
  }
  const ai = client();
  await ai.fileSearchStores.delete({ name, config: { force: true } });
  console.log(`Deleted ${name}`);
}

const [, , command, ...rest] = process.argv;
switch (command) {
  case "create-store":
    await createStore();
    break;
  case "upload":
    await upload(rest[0], rest[1]);
    break;
  case "list":
    await list();
    break;
  case "delete-store":
    await deleteStore(rest[0]);
    break;
  default:
    console.log(
      [
        "Usage:",
        "  bun scripts/gemini-file-search.mjs create-store",
        "  bun scripts/gemini-file-search.mjs upload <file> [display name]",
        "  bun scripts/gemini-file-search.mjs list",
        "  bun scripts/gemini-file-search.mjs delete-store <name>",
      ].join("\n"),
    );
}
