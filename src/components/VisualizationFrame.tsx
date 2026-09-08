import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Expand,
  Loader2,
  Maximize2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Renders a self-contained HTML visualization in a sandboxed iframe.
 * `allow-scripts` is required for the sim's own JS; no same-origin, so the
 * generated code can never touch the app's DOM, cookies or storage.
 */
export function VisualizationFrame({
  title,
  html,
  onDelete,
  compact = false,
}: {
  title: string;
  html: string;
  onDelete?: () => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const heightClass = compact ? "h-64" : "h-[420px]";

  return (
    <div className="mt-3 overflow-hidden rounded-xl border bg-background shadow-sm">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
          <Expand className="size-3" />
        </span>
        <p className="min-w-0 flex-1 truncate text-xs font-semibold">
          {title}
        </p>
        {onDelete && (
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-muted-foreground hover:text-destructive"
            aria-label="Delete visualization"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-6 text-muted-foreground"
          aria-label="Expand visualization"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 className="size-3.5" />
        </Button>
      </div>
      <iframe
        title={title}
        srcDoc={html}
        sandbox="allow-scripts"
        className={cn("w-full bg-white", heightClass)}
      />

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden">
          <DialogHeader className="flex-row items-center gap-2 border-b bg-muted/40 px-4 py-3">
            <DialogTitle className="min-w-0 flex-1 truncate text-sm">
              {title}
            </DialogTitle>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Close"
              onClick={() => setExpanded(false)}
            >
              <X className="size-4" />
            </Button>
          </DialogHeader>
          <iframe
            title={`${title} (expanded)`}
            srcDoc={html}
            sandbox="allow-scripts"
            className="h-[70vh] w-full bg-white"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Generating placeholder shown while the sim is being built. */
export function VisualizationSkeleton() {
  return (
    <div className="mt-3 flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/30">
      <Loader2 className="size-5 animate-spin text-primary" />
      <p className="text-xs text-muted-foreground">
        Building an interactive visualization…
      </p>
    </div>
  );
}
