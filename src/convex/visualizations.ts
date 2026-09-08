import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { chatCompletion } from "./lib/ai";

/**
 * AI-generated interactive visualizations.
 *
 * A visualization is a single self-contained HTML document (inline CSS + JS,
 * no external requests) rendered in a sandboxed iframe. The model is told to
 * produce a teaching sim: labelled diagram, animated process, or interactive
 * controls (sliders/buttons) that demonstrate the concept being discussed.
 */

const MAX_PER_MESSAGE = 3;

const VIS_PROMPT = `You generate interactive educational visualizations as single-file HTML documents for Edexcel students.

Output rules (violating any makes the result unusable):
1. Output ONLY the HTML document. No markdown fences, no commentary.
2. One complete <!DOCTYPE html> document. All CSS in a <style> tag, all JS in a <script> tag. NO external resources: no CDN scripts, no fonts, no images, no fetch/XHR — it must work fully offline inside a sandboxed iframe.
3. Light, clean, high-contrast design suitable for studying: white/near-white background, dark text, one accent colour. System font stack. Generous spacing.
4. Make it genuinely interactive where the concept allows: sliders, buttons, draggable elements, or animation with play/pause. The interaction must teach the idea (e.g. dragging a slider changes a value and the diagram responds).
5. Label everything clearly (axes, parts, units). Include a one-line caption of what the sim shows.
6. Keep it under ~180 lines so it stays focused. No user input storage, no localStorage, no cookies.
7. Escape nothing — emit real HTML.

Good subjects: enzyme activity vs temperature, projectile motion, supply & demand shifts, wave interference, circuit with variable resistor, cell division stages, market equilibrium, rate graphs, reflex arc, radioactive decay.`;

interface VisResult {
  title: string;
  html: string;
}

function parseVisResponse(raw: string): VisResult | null {
  let text = raw.trim();
  // Strip markdown fences if the model added them anyway.
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  if (!/^<!doctype html/i.test(text) && !/^<html/i.test(text)) return null;

  const titleMatch = text.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim() || "Interactive visualization";
  return { title, html: text };
}

/** Build a compact summary of the lesson so far for generation context. */
function buildContextSnippet(
  messageContent: string,
  chatTitle: string | undefined,
  subject: string | undefined,
): string {
  return [
    chatTitle ? `Lesson: ${chatTitle}` : "",
    subject ? `Subject: ${subject}` : "",
    "Tutor answer to visualize:",
    messageContent.slice(0, 4000),
  ]
    .filter(Boolean)
    .join("\n");
}

export const generateFromMessage = action({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const message = await ctx.db.get(args.messageId);
    if (!message || message.userId !== userId) {
      throw new Error("Message not found");
    }
    if (!message.content.trim()) {
      throw new Error("This answer is too short to visualize yet.");
    }

    const existing = await ctx.db
      .query("visualizations")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
    if (existing.length >= MAX_PER_MESSAGE) {
      throw new Error(
        `This answer already has ${MAX_PER_MESSAGE} visualizations.`,
      );
    }

    const chat = message.chatId
      ? await ctx.db.get(message.chatId)
      : undefined;

    const context = buildContextSnippet(
      message.content,
      chat?.title,
      chat?.subject,
    );

    const res = await chatCompletion(
      [
        { role: "system", content: VIS_PROMPT },
        {
          role: "user",
          content: `Create ONE interactive visualization that teaches the core idea of this lesson. Prefer the single most illuminating sim over a busy dashboard.\n\n${context}`,
        },
      ],
      { model: "gpt-4o", temperature: 0.4, maxTokens: 6000 },
    );

    const parsed = parseVisResponse(res.content);
    if (!parsed) {
      throw new Error(
        "Couldn't build a valid visualization from that answer. Try again.",
      );
    }

    const id = await ctx.runMutation(internal.visualizationsInternal._insert, {
      userId,
      chatId: message.chatId,
      messageId: message._id,
      title: parsed.title,
      html: parsed.html,
    });

    return { visualizationId: id, title: parsed.title };
  },
});

export const listForMessage = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("visualizations")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
    return rows
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const remove = mutation({
  args: { visualizationId: v.id("visualizations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(args.visualizationId);
    if (!row || row.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(args.visualizationId);
  },
});
