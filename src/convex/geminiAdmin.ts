//
// TEMPORARY admin/diagnostic driver for the Gemini File Search store —
// deleted after the duplicate-document cleanup and race-fix verification.
//
"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getGeminiClient, resolveGeminiStoreName } from "./lib/gemini";

interface StoreDocInfo {
  name: string;
  displayName: string | null;
  state: string | null;
  createTime: string | null;
  owner: string | null;
}

export const listDocs = internalAction({
  args: {},
  handler: async (): Promise<StoreDocInfo[]> => {
    const ai = getGeminiClient();
    const store = await resolveGeminiStoreName();
    const pager = await ai.fileSearchStores.documents.list({
      parent: store,
      config: { pageSize: 20 },
    });
    const out: StoreDocInfo[] = [];
    for await (const doc of pager) {
      const d = doc as unknown as {
        name?: string;
        displayName?: string;
        state?: string;
        createTime?: string;
        customMetadata?: Array<{ key: string; stringValue?: string }>;
      };
      out.push({
        name: d.name ?? "?",
        displayName: d.displayName ?? null,
        state: d.state ?? null,
        createTime: d.createTime ?? null,
        owner:
          d.customMetadata?.find((m) => m.key === "owner")?.stringValue ?? null,
      });
    }
    return out;
  },
});

export const deleteStoreDoc = internalAction({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const ai = getGeminiClient();
    await ai.fileSearchStores.documents.delete({
      name: args.name,
      config: { force: true },
    });
    return { deleted: args.name };
  },
});

// Dump the REAL shape of an upload operation (the .d.ts declares no response
// fields) and delete the probe doc afterwards.
export const probeUploadShape = internalAction({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    const ai = getGeminiClient();
    const store = await resolveGeminiStoreName();
    const file = new Blob(["probe: upload operation response shape test"], {
      type: "text/plain",
    });
    let op = await ai.fileSearchStores.uploadToFileSearchStore({
      file,
      fileSearchStoreName: store,
      config: {
        displayName: "zz-probe-upload-shape",
        customMetadata: [{ key: "owner", stringValue: "probe" }],
      },
    });
    let waited = 0;
    while (!op.done && waited < 120_000) {
      await new Promise((r) => setTimeout(r, 2000));
      waited += 2000;
      op = await ai.operations.get({ operation: op });
    }
    const dump: Record<string, unknown> = {
      done: op.done,
      topKeys: Object.keys(op),
      name: op.name,
      metadata: op.metadata ?? null,
      responseKeys:
        op.response !== undefined ? Object.keys(op.response) : null,
      response: (op.response as unknown) ?? null,
    };
    // Find + delete the probe doc by displayName (tests the list+match path).
    const pager = await ai.fileSearchStores.documents.list({
      parent: store,
      config: { pageSize: 20 },
    });
    for await (const doc of pager) {
      const d = doc as unknown as { displayName?: string; name?: string };
      if (d.displayName === "zz-probe-upload-shape" && d.name) {
        await ai.fileSearchStores.documents.delete({
          name: d.name,
          config: { force: true },
        });
        dump.deletedProbe = d.name;
      }
    }
    return dump;
  },
});

export const _newUploadUrl = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Race test: schedule the REAL uploadToGemini action twice for the same
 * source row at delay 0 (mirroring createSource + a racing retry), then
 * report the row state and the store's copy count for the display name.
 */
export const raceTest = internalAction({
  args: {
    userId: v.id("users"),
    storageId: v.id("_storage"),
    displayName: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    sourceId: Id<"sources">;
    row: Record<string, unknown>;
    storeCopies: number;
  }> => {
    const sourceId = (await ctx.runMutation(
      internal.geminiAdminData.insertRaceRow,
      { userId: args.userId, storageId: args.storageId, name: args.displayName },
    )) as Id<"sources">;
    await ctx.scheduler.runAfter(0, internal.processSourceActions.uploadToGemini, {
      sourceId,
      userId: args.userId,
      storageId: args.storageId,
    });
    await ctx.scheduler.runAfter(0, internal.processSourceActions.uploadToGemini, {
      sourceId,
      userId: args.userId,
      storageId: args.storageId,
    }
    );
    // Wait for both runs to finish (each is ~5–15s for a tiny file).
    let row: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      row = (await ctx.runQuery(internal.geminiAdminData.getRow, {
        sourceId,
      })) as Record<string, unknown>;
      if (row.geminiDocName && !row.claimAt) break;
      if (i === 39) break;
  }
    const store = await resolveGeminiStoreName();
    const ai = getGeminiClient();
    const pager = await ai.fileSearchStores.documents.list({
      parent: store,
      config: { pageSize: 20 },
    });
    let storeCopies = 0;
    const names: string[] = [];
    for await (const doc of pager) {
      const d = doc as unknown as { displayName?: string; name?: string };
      if (d.displayName === args.displayName && d.name) {
        storeCopies++;
        names.push(d.name);
      }
    }
    return { sourceId, row, storeCopies };
  },
});
