import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { QUALIFICATIONS } from "@/lib/curriculum";
import { formatRemainingCooldown } from "@/lib/cooldown-format";
import {
  AlertTriangle,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Presentation,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type SourceDoc = Doc<"sources">;
type CollectionDoc = Doc<"collections">;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectType(file: File): SourceDoc["type"] {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".pptx")) return "pptx";
  if (name.endsWith(".txt")) return "txt";
  if (name.endsWith(".md")) return "md";
  if (file.type.startsWith("image/")) return "image";
  return "unknown";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TypeIcon({ type }: { type: SourceDoc["type"] }) {
  const cls = "size-5";
  switch (type) {
    case "pdf":
      return <FileText className={cls} />;
    case "pptx":
      return <Presentation className={cls} />;
    default:
      return <FileText className={cls} />;
  }
}

function StatusBadge({ source }: { source: SourceDoc }) {
  switch (source.status) {
    case "ready":
      return (
        <Badge className="gap-1 bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/15 dark:text-emerald-400">
          Ready
        </Badge>
      );
    case "processing":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="size-3 animate-spin" />
          Processing
        </Badge>
      );
    case "queued":
      return <Badge variant="secondary">Queued</Badge>;
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="size-3" />
          Failed
        </Badge>
      );
  }
}

// A source stuck in queued/processing for over 10 minutes is treated as
// retryable — its pipeline run most likely died.
const STUCK_AFTER_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Source card
// ---------------------------------------------------------------------------

function SourceCard({
  source,
  collections,
  onDelete,
  onRetry,
}: {
  source: SourceDoc;
  collections: CollectionDoc[];
  onDelete: (id: Id<"sources">) => void;
  onRetry: (id: Id<"sources">) => void;
}) {
  const updateMeta = useMutation(api.sources.updateSourceMeta);
  const stuck =
    (source.status === "processing" || source.status === "queued") &&
    Date.now() - source.updatedAt > STUCK_AFTER_MS;

  return (
    <div className="flex flex-col rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <TypeIcon type={source.type} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={source.name}>
            {source.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(source.size)}
            {source.pageCount ? ` · ${source.pageCount} pages` : ""}
            {source.chunkCount ? ` · ${source.chunkCount} passages` : ""}
          </p>
        </div>
        <button
          type="button"
          aria-label="Delete source"
          onClick={() => onDelete(source._id)}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <StatusBadge source={source} />
        {source.retrievalMode === "semantic" && (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            semantic search
          </Badge>
        )}
        {(source.status === "failed" || stuck) && (
          <button
            type="button"
            onClick={() => onRetry(source._id)}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <RotateCcw className="size-3" />
            Retry
          </button>
        )}
      </div>

      {stuck && source.status !== "failed" && (
        <p className="mt-2 rounded-lg bg-amber-500/10 p-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
          This has been processing for longer than expected — hit Retry to
          re-run it. Nothing was lost; it picks up from the same file.
        </p>
      )}

      {source.status === "failed" &&
        source.error &&
        source.error.trim() && (
        <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-xs leading-5 text-destructive">
          {source.error}
        </p>
      )}

      {source.topicsDetected && source.topicsDetected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {source.topicsDetected.slice(0, 4).map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="text-[10px] font-normal"
            >
              {t}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-auto pt-3">
        <Select
          value={source.collectionId ?? "none"}
          onValueChange={(v) =>
            void updateMeta({
              sourceId: source._id,
              collectionId: v === "none" ? null : (v as Id<"collections">),
            })
          }
        >
          <SelectTrigger className="h-8 w-full text-xs">
            <FolderOpen className="mr-1 size-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No collection</SelectItem>
            {collections.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Sources() {
  const sources = useQuery(api.sources.listSources);
  const collections = useQuery(api.sources.listCollections);
  // Per-student large-upload cooldown (ms remaining); refreshed every 30s so
  // the hint counts down without manual refresh.
  const cooldown = useQuery(api.sources.getCooldown);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const cooldownRemainingMs = cooldown ? Math.max(0, cooldown.remainingMs - (Date.now() - now)) : 0;
  const aiStatus = useQuery(api.aiStatus.getStatus);
  const profile = useQuery(api.profiles.getMyProfile);

  const generateUploadUrl = useMutation(api.sources.generateUploadUrl);
  const createSource = useMutation(api.sources.createSource);
  const deleteSource = useAction(api.sources.deleteSource);
  const retrySource = useMutation(api.sources.retrySource);
  const createCollection = useMutation(api.sources.createCollection);
  const deleteCollection = useMutation(api.sources.deleteCollection);

  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [activeCollection, setActiveCollection] = useState<string>("all");
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  // Subject tag applied to uploads. Defaults to the student's focus subject
  // from onboarding; the options come from the profile's qualification only,
  // so the list always matches the dashboard's subject selector.
  const [uploadSubject, setUploadSubject] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const qualificationSubjects = useMemo(() => {
    const qual = QUALIFICATIONS.find((q) => q.id === profile?.qualification);
    return qual?.subjects ?? [];
  }, [profile?.qualification]);

  useEffect(() => {
    if (profile?.subject) setUploadSubject(profile.subject);
  }, [profile?.subject]);

  const allSources = sources ?? [];
  const filtered = useMemo(
    () =>
      activeCollection === "all"
        ? allSources
        : allSources.filter((s) => s.collectionId === activeCollection),
    [allSources, activeCollection],
  );

  const uploadFiles = async (files: Iterable<File>) => {
    if (!uploadSubject) {
      toast.error("Pick a subject for these files first.");
      return;
    }
    setUploading((n) => n + 1);
    try {
      for (const file of files) {
        const type = detectType(file);
        if (type === "image" || type === "unknown") {
          toast.error(
            `${file.name}: unsupported for now — upload PDF, DOCX, PPTX, TXT or MD.`,
          );
          continue;
        }
        try {
          const uploadUrl = await generateUploadUrl({ size: file.size });
          const res = await fetch(uploadUrl, {
            method: "POST",
            body: file,
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
          });
          if (!res.ok) throw new Error(`upload failed (${res.status})`);
          const { storageId } = (await res.json()) as { storageId: string };
          await createSource({
            storageId: storageId as Id<"_storage">,
            name: file.name,
            type,
            size: file.size,
            subject: uploadSubject,
            collectionId:
              activeCollection === "all"
                ? undefined
                : (activeCollection as Id<"collections">),
          });
          toast.success(
            `${file.name} uploaded as ${uploadSubject} — processing now.`,
          );
        } catch (err) {
          toast.error(
            `${file.name}: ${err instanceof Error ? err.message : "upload failed"}`,
          );
        }
      }
    } finally {
      setUploading((n) => Math.max(0, n - 1));
    }
  };

  const handleDeleteSource = async (id: Id<"sources">) => {
    try {
      await deleteSource({ sourceId: id });
      toast.success("Source deleted.");
    } catch {
      toast.error("Couldn't delete that source.");
    }
  };

  const handleRetrySource = async (id: Id<"sources">) => {
    try {
      await retrySource({ sourceId: id });
      toast.success("Re-processing that source now.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't retry that source.",
      );
    }
  };

  const handleCreateCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    try {
      await createCollection({ name });
      setNewCollectionName("");
      setNewCollectionOpen(false);
      toast.success(`Collection “${name}” created.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create it.");
    }
  };

  const handleDeleteCollection = async (c: CollectionDoc) => {
    try {
      await deleteCollection({ collectionId: c._id });
      if (activeCollection === c._id) setActiveCollection("all");
      toast.success(`Collection “${c.name}” deleted.`);
    } catch {
      toast.error("Couldn't delete that collection.");
    }
  };

  return (
    <AppShell>
      <div className="px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Sources
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload textbooks, notes, past papers and specs. Turn on
            “Sources&nbsp;only” in any lesson and Lumen will answer strictly
            from these — with page-cited evidence.
          </p>
        </header>

        {/* Retrieval mode banner */}
        {aiStatus && (
          <div className="mb-6 flex items-start gap-2.5 rounded-xl border bg-card p-3.5 text-sm">
            {aiStatus.embeddingsConfigured ? (
              <>
                <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="text-muted-foreground">
                  <strong className="text-foreground">
                    Semantic search active.
                  </strong>{" "}
                  Questions find the most relevant passages in your sources,
                  not just keyword matches.
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <span className="text-muted-foreground">
                  <strong className="text-foreground">
                    Keyword search only.
                  </strong>{" "}
                  Add a <code>GEMINI_API_KEY</code> in the Keys panel to enable
                  semantic retrieval — sources still work with exact keyword
                  matching.
                </span>
              </>
            )}
          </div>
        )}

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void uploadFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border bg-card hover:border-primary/40"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.pptx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {uploading > 0 ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <UploadCloud className="size-6" />
            )}
          </div>
          <p className="mt-3 text-sm font-medium">
            {uploading > 0 ? "Uploading…" : "Drop files here or click to upload"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            PDF, Word, PowerPoint, TXT or MD — up to 600 pages each
          </p>
          {cooldownRemainingMs > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-3.5" />
              Large files (over 25 MB) are limited to one every 90 minutes —
              next one in {formatRemainingCooldown(cooldownRemainingMs)}.
            </p>
          )}
        </div>

        {/* Subject tag for uploads — mirrors the dashboard's focus-subject
            list for the student's own qualification. */}
        <div className="mt-4 flex flex-col items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            Subject for these files
          </label>
          <Select
            value={uploadSubject}
            onValueChange={setUploadSubject}
          >
            <SelectTrigger className="w-64">
              <SelectValue
                placeholder={
                  qualificationSubjects.length === 0
                    ? "Complete onboarding to pick a subject"
                    : "Pick a subject"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {qualificationSubjects.map((s) => (
                <SelectItem key={s.id} value={s.name}>
                  {s.name}
                </SelectItem>
              ))
              }
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Answers in a subject's tutor only search files tagged with that
            same subject.
          </p>
        </div>

        {/* Collections */}
        <div className="mt-8 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveCollection("all")}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              activeCollection === "all"
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            All sources
          </button>
          {(collections ?? []).map((c) => (
            <span key={c._id} className="group relative inline-flex">
              <button
                type="button"
                onClick={() => setActiveCollection(c._id)}
                className={`rounded-full border px-3.5 py-1.5 pr-8 text-sm font-medium transition-colors ${
                  activeCollection === c._id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {c.name}
              </button>
              <button
                type="button"
                aria-label={`Delete ${c.name}`}
                onClick={() => void handleDeleteCollection(c)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-current opacity-40 transition-opacity hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </span>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-full"
            onClick={() => setNewCollectionOpen(true)}
          >
            <Plus className="size-3.5" />
            New collection
          </Button>
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border bg-card p-10 text-center">
            <p className="text-sm font-medium">No sources here yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Upload your textbook chapters, class notes, or past papers above.
              Once a source is ready, Lumen can cite it page by page.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s) => (
              <SourceCard
                key={s._id}
                source={s}
                collections={collections ?? []}
                onDelete={(id) => void handleDeleteSource(id)}
                onRetry={(id) => void handleRetrySource(id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* New collection dialog */}
      <Dialog open={newCollectionOpen} onOpenChange={setNewCollectionOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New collection</DialogTitle>
            <DialogDescription>
              Group sources by subject or purpose, e.g. “My Biology Sources”.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateCollection();
            }}
            placeholder="My Biology Sources"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewCollectionOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreateCollection()}
              disabled={!newCollectionName.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
