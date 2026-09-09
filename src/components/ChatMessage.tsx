import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { BookOpen, CircleAlert, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface Citation {
  /** Chunk-level citation from the local RAG fallback. */
  sourceId?: string;
  sourceName?: string;
  /** Document-level citation from Gemini File Search. */
  documentTitle?: string;
  /** Raw source pointer from Gemini grounding metadata. */
  uri?: string;
  page?: number;
  snippet?: string;
}

/** Markdown renderer for tutor answers. */
export function Markdown({
  content,
  streaming = false,
  className,
}: {
  content: string;
  streaming?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("prose-lumen", streaming && "stream-caret", className)}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

/**
 * Clickable [Source: name, Page n] chips. Each opens a popover with the
 * actual passage the answer was grounded in.
 */
export function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations || citations.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
      {citations.map((c, i) => {
        const label = c.sourceName ?? c.documentTitle ?? "Source";
        return (
          <Popover
            key={`${c.sourceId ?? c.documentTitle ?? "doc"}-${c.page ?? "np"}-${i}`}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <BookOpen className="size-3 shrink-0" />
                <span className="truncate">
                  Source: {label}
                  {c.page ? `, Page ${c.page}` : ""}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
                {c.page ? ` · Page ${c.page}` : ""}
              </p>
              <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-foreground">
                {c.snippet ??
                  (c.uri
                    ? "Retrieved passage from your uploaded Edexcel documents."
                    : "No preview available.")}
              </p>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}

/** "Lumen is thinking" indicator. */
export function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "size-2 animate-bounce rounded-full bg-primary/60",
            i === 1 && "[animation-delay:150ms]",
            i === 2 && "[animation-delay:300ms]",
          )}
        />
      ))}
    </div>
  );
}

/** Small badge used to flag the answering mode of a message. */
export function ModeBadge({ mode }: { mode?: "sources" | "outside" }) {
  if (!mode) return null;
  return (
    <Badge
      variant="outline"
      className="border-border/70 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
    >
      {mode === "sources" ? "From your sources" : "Outside knowledge"}
    </Badge>
  );
}

const GROUNDING_REASON_LABELS: Record<string, string> = {
  acknowledgment: "no search needed",
  followup: "no search needed",
  empty: "no search needed",
  outside: "outside knowledge",
  quota: "weekly quota reached",
};

/**
 * Transparency indicator: was this answer checked against the student's
 * sources (spending a File Search query) or answered without a search?
 * Only renders once the grounding state is known (undefined = still deciding
 * or legacy message).
 */
export function GroundingBadge({
  grounded,
  reason,
}: {
  grounded?: boolean;
  reason?: string;
}) {
  if (grounded === undefined) return null;
  const qualifier = reason ? GROUNDING_REASON_LABELS[reason] : undefined;
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border text-[10px] font-medium",
        grounded
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
    >
      {grounded ? (
        <ShieldCheck className="size-3" />
      ) : (
        <CircleAlert className="size-3" />
      )}
      {grounded ? "Grounded in sources" : "Not grounded"}
      {qualifier ? ` · ${qualifier}` : ""}
    </Badge>
  );
}
