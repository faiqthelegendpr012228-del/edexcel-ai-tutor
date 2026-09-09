import {
  AppShell,
} from "@/components/AppShell";
import {
  CitationList,
  GroundingBadge,
  Markdown,
  ModeBadge,
  TypingDots,
} from "@/components/ChatMessage";
import {
  VisualizationFrame,
  VisualizationSkeleton,
} from "@/components/VisualizationFrame";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { formatResetIn } from "@/lib/cooldown-format";
import { cn } from "@/lib/utils";
import { QUALIFICATIONS } from "@/lib/curriculum";
import { useAction, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  BookOpenCheck,
  Expand,
  GraduationCap,
  History,
  Layers,
  Lightbulb,
  ListChecks,
  Plus,
  Send,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Starter prompts — the pedagogy entry points (teach / quiz / notes / cards)
// ---------------------------------------------------------------------------

const STARTERS = [
  {
    icon: GraduationCap,
    label: "Teach me step by step",
    prompt:
      "I'm stuck on a topic in my subject. Teach it to me step by step, check that I follow, then give me one quick question to test my understanding.",
  },
  {
    icon: ListChecks,
    label: "Quiz me",
    prompt:
      "Quiz me with 5 exam-style questions on my focus subject, one at a time. Mark each of my answers and explain my mistakes.",
  },
  {
    icon: StickyNote,
    label: "Revision notes",
    prompt:
      "Create concise revision notes for my focus subject: key definitions, formulas, and the most common exam mistakes.",
  },
  {
    icon: Layers,
    label: "Make flashcards",
    prompt:
      "Turn the key ideas of my focus subject into flashcards: question on one side, answer on the other. Start with five.",
  },
] as const;

// ---------------------------------------------------------------------------
// Start screen (no chat selected)
// ---------------------------------------------------------------------------

function StartScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const profile = useQuery(api.profiles.getMyProfile);
  const sources = useQuery(api.sources.listSources);
  const createChat = useMutation(api.chats.createChat);

  const [qualification, setQualification] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const readySources = useMemo(
    () => (sources ?? []).filter((s) => s.status === "ready").length,
    [sources],
  );

  useEffect(() => {
    if (!qualification && profile?.qualification) {
      setQualification(profile.qualification);
      setSubject(profile.subject ?? "");
    }
  }, [profile, qualification]);

  const subjects =
    QUALIFICATIONS.find((q) => q.id === qualification)?.subjects ?? [];

  const start = async (prompt?: string) => {
    if (!qualification || !subject) return;
    setCreating(true);
    try {
      const qual = QUALIFICATIONS.find((q) => q.id === qualification);
      const subj = qual?.subjects.find((s) => s.id === subject);
      const chatId = await createChat({
        subject: subj?.name,
        qualification: qual?.shortName,
      });
      navigate(`/tutor/${chatId}`, {
        state: prompt ? { initialPrompt: prompt } : undefined,
      });
    } catch {
      toast.error("Couldn't start the lesson. Please try again.");
      setCreating(false);
    }
  };

  const greetingName = user?.name?.split(" ")[0];

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-amber-500 text-primary-foreground shadow-lg">
            <Lightbulb className="size-7" />
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {greetingName ? `Welcome back, ${greetingName}.` : "Welcome back."}
          </h1>
          <p className="mt-2 text-muted-foreground">
            What are we mastering today?
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="mb-3 text-sm font-medium">Pick your syllabus</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              value={qualification}
              onValueChange={(v) => {
                setQualification(v);
                setSubject("");
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Qualification" />
              </SelectTrigger>
              <SelectContent>
                {QUALIFICATIONS.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {q.shortName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={subject}
              onValueChange={setSubject}
              disabled={!qualification}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Subject" />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {STARTERS.map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={!qualification || !subject || creating}
                onClick={() => void start(s.prompt)}
                className="flex items-center gap-3 rounded-xl border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/50 disabled:opacity-50"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="size-4.5" />
                </span>
                <span className="text-sm font-medium">{s.label}</span>
              </button>
            ))}
          </div>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            {readySources > 0
              ? `${readySources} source${readySources === 1 ? "" : "s"} ready — enable "Sources only" in a lesson to ground every answer in them.`
              : "Tip: upload your textbook or notes in Sources to ground answers with citations."}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lessons sidebar list
// ---------------------------------------------------------------------------

function LessonItem({
  chat,
  active,
  onOpen,
  onDelete,
}: {
  chat: Doc<"chats">;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
        active ? "bg-secondary" : "hover:bg-secondary/60",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 px-3 py-2 text-left"
      >
        <p
          className={cn(
            "truncate text-sm",
            active ? "font-medium text-foreground" : "text-foreground/80",
          )}
        >
          {chat.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {chat.subject ?? "General"}
          {chat.sourceMode ? " · sources only" : ""}
          {" · "}
          {formatDistanceToNow(chat.updatedAt, { addSuffix: true })}
        </p>
      </button>
      <button
        type="button"
        aria-label="Delete lesson"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function LessonList({
  chats,
  activeId,
  onOpen,
  onDelete,
}: {
  chats: Doc<"chats">[];
  activeId?: string;
  onOpen: (id: string) => void;
  onDelete: (id: Id<"chats">) => void;
}) {
  if (chats.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        No lessons yet. Start one and it will appear here.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {chats.map((chat) => (
        <LessonItem
          key={chat._id}
          chat={chat}
          active={chat._id === activeId}
          onOpen={() => onOpen(chat._id)}
          onDelete={() => onDelete(chat._id)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function UserBubble({ content, pending }: { content: string; pending?: boolean }) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-6 text-primary-foreground",
          pending && "opacity-70",
        )}
      >
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  onAllowOutside,
  allowingOutside,
  onReground,
  regrounding,
}: {
  message: Doc<"messages">;
  onAllowOutside: () => void;
  allowingOutside: boolean;
  onReground: () => void;
  regrounding: boolean;
}) {
  const navigate = useNavigate();
  const generateCards = useAction(api.practice.generateFromMessage);
  const generateVis = useAction(api.visualizations.generateFromMessage);
  const removeVis = useMutation(api.visualizations.remove);
  const visualizations = useQuery(
    api.visualizations.listForMessage,
    message.status === "complete" ? { messageId: message._id } : "skip",
  );
  const [generatingCards, setGeneratingCards] = useState(false);
  const [generatingVis, setGeneratingVis] = useState(false);

  const thinking =
    (message.status === "thinking" || message.status === "streaming") &&
    message.content.trim().length === 0;

  const handleGenerateCards = async () => {
    if (generatingCards) return;
    setGeneratingCards(true);
    try {
      const count = await generateCards({ messageId: message._id });
      toast.success(
        `${count} flashcard${count === 1 ? "" : "s"} created.`,
        {
          action: {
            label: "Review",
            onClick: () => navigate("/flashcards"),
          },
        },
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't create flashcards.",
      );
    } finally {
      setGeneratingCards(false);
    }
  };

  const handleGenerateVis = async () => {
    if (generatingVis) return;
    setGeneratingVis(true);
    try {
      await generateVis({ messageId: message._id });
      toast.success("Visualization ready.");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't create the visualization.",
      );
    } finally {
      setGeneratingVis(false);
    }
  };

  const handleRemoveVis = async (visualizationId: string) => {
    try {
      await removeVis({
        visualizationId: visualizationId as Id<"visualizations">,
      });
    } catch {
      toast.error("Couldn't remove the visualization.");
    }
  };

  return (
    <div className="flex gap-3">
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-amber-500 text-primary-foreground">
        <Lightbulb className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">Lumen</span>
          {message.status === "complete" && (
            <GroundingBadge
              grounded={message.grounded}
              reason={message.groundingReason}
            />
          )}
          {message.status === "complete" && (
            <ModeBadge mode={message.mode} />
          )}
        </div>
        <div className="rounded-2xl rounded-tl-md border bg-card px-4 py-3 shadow-sm">
          {thinking ? (
            <TypingDots />
          ) : (
            <>
              <Markdown
                content={message.content}
                streaming={message.status === "streaming"}
              />
              {message.status === "complete" && (
                <CitationList citations={message.citations ?? []} />
              )}
              {message.status === "complete" &&
                message.content.trim().length > 0 &&
                !message.needsPermission && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground"
                      disabled={generatingCards}
                      onClick={() => void handleGenerateCards()}
                    >
                      <Layers className="size-3.5" />
                      {generatingCards ? "Creating flashcards…" : "Make flashcards"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground"
                      disabled={generatingVis}
                      onClick={() => void handleGenerateVis()}
                    >
                      <Expand className="size-3.5" />
                      {generatingVis ? "Building visualization…" : "Visualize it"}
                    </Button>
                  </div>
                )}
              {generatingVis && <VisualizationSkeleton />}
              {(visualizations ?? []).map((v) => (
                <VisualizationFrame
                  key={v._id}
                  title={v.title}
                  html={v.html}
                  onDelete={() => void handleRemoveVis(v._id)}
                />
              ))}
              {message.needsPermission && (
                <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-sm font-medium text-foreground">
                    Not covered in your selected sources
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Allow outside knowledge for this answer only, or upload a
                    source that covers it.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={allowingOutside}
                    onClick={onAllowOutside}
                  >
                    Allow outside knowledge
                  </Button>
                </div>
              )}
              {message.status === "error" && (
                <p className="mt-2 text-xs text-destructive">{message.error}</p>
              )}
              {message.status === "complete" &&
                message.grounded === false &&
                !message.needsPermission && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                    <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                      This answer wasn't checked against your sources.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 rounded-full px-2.5 text-xs"
                      disabled={regrounding}
                      onClick={onReground}
                    >
                      <BookOpenCheck className="size-3.5" />
                      {regrounding ? "Checking sources…" : "Check my sources"}
                    </Button>
                  </div>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat view
// ---------------------------------------------------------------------------

function ChatView({ chatId }: { chatId: Id<"chats"> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const data = useQuery(api.chats.getChat, { chatId });
  const allSources = useQuery(api.sources.listSources);
  const chats = useQuery(api.chats.listChats);

  const sendAction = useAction(api.chats.askTutor);
  const updateChat = useMutation(api.chats.updateChat);
  const deleteChat = useMutation(api.chats.deleteChat);

  // Grounded-answer quota (rolling weekly window) for the composer hint.
  const quota = useQuery(api.usage.getMyQuota);

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [allowingOutside, setAllowingOutside] = useState(false);
  const [regrounding, setRegrounding] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialPromptSent = useRef(false);

  const chat = data?.chat;
  const messages = useMemo(() => data?.messages ?? [], [data]);
  const readySources = useMemo(
    () => (allSources ?? []).filter((s) => s.status === "ready"),
    [allSources],
  );

  const lastUserContent =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const send = async (text: string, allowOutside = false) => {
    const content = text.trim();
    if (!content) return;
    if (!allowOutside) setPending(content);
    setAllowingOutside(allowOutside);
    try {
      await sendAction({ chatId, content, allowOutside });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't send the message.",
      );
    } finally {
      setPending(null);
      setAllowingOutside(false);
    }
  };

  // Auto-sent prompt handed over from the start screen.
  const initialPrompt = (
    location.state as { initialPrompt?: string } | null
  )?.initialPrompt;
  useEffect(() => {
    if (!data || initialPromptSent.current) return;
    if (initialPrompt && data.messages.length === 0) {
      initialPromptSent.current = true;
      void send(initialPrompt);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, initialPrompt]);

  // Keep pinned to the bottom while streaming (unless the user scrolled up).
  useEffect(() => {
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, pending, atBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft;
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    void send(text);
  };

  // "Check my sources": re-run the last question through retrieval so an
  // ungrounded answer can be upgraded to a grounded one.
  const handleReground = async () => {
    if (regrounding) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setRegrounding(true);
    try {
      await sendAction({ chatId, content: lastUser.content, reground: true });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't check sources.",
      );
    } finally {
      setRegrounding(false);
    }
  };

  const handleDelete = async (id: Id<"chats">) => {
    try {
      await deleteChat({ chatId: id });
      if (id === chatId) navigate("/tutor");
    } catch {
      toast.error("Couldn't delete the lesson.");
    }
  };

  if (data === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading lesson…
      </div>
    );
  }

  if (!chat) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-muted-foreground">
          This lesson doesn't exist or was deleted.
        </p>
        <Button variant="outline" onClick={() => navigate("/tutor")}>
          <ArrowLeft className="size-4" />
          Back to Tutor
        </Button>
      </div>
    );
  }

  const sourceModeOn = chat.sourceMode;

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* Lessons column (desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border/70 bg-sidebar lg:flex">
        <div className="p-3">
          <Button
            className="w-full justify-start gap-2"
            onClick={() => navigate("/tutor")}
          >
            <Plus className="size-4" />
            New lesson
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <LessonList
            chats={chats ?? []}
            activeId={chatId}
            onOpen={(id) => navigate(`/tutor/${id}`)}
            onDelete={(id) => void handleDelete(id)}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-border/70 bg-background/80 px-3 py-2.5 backdrop-blur sm:px-4">
          {/* Mobile lesson switcher */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 lg:hidden"
                aria-label="Lessons"
              >
                <History className="size-4.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-2">
              <Button
                size="sm"
                className="mb-2 w-full justify-start gap-2"
                onClick={() => navigate("/tutor")}
              >
                <Plus className="size-4" />
                New lesson
              </Button>
              <LessonList
                chats={chats ?? []}
                activeId={chatId}
                onOpen={(id) => navigate(`/tutor/${id}`)}
                onDelete={(id) => void handleDelete(id)}
              />
            </PopoverContent>
          </Popover>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{chat.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[chat.qualification, chat.subject].filter(Boolean).join(" · ") ||
                "General"}
            </p>
          </div>

          {/* Source picker */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "shrink-0 gap-1.5",
                  chat.selectedSourceIds.length > 0 && "border-primary/40",
                )}
              >
                <BookOpenCheck className="size-4" />
                <span className="hidden sm:inline">
                  {chat.selectedSourceIds.length > 0
                    ? `${chat.selectedSourceIds.length} source${chat.selectedSourceIds.length === 1 ? "" : "s"}`
                    : "All sources"}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3">
              <p className="text-sm font-medium">Sources for this lesson</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Nothing selected means every ready source is searchable.
              </p>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {readySources.length === 0 && (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    No sources ready yet.{" "}
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => navigate("/sources")}
                    >
                      Upload one
                    </button>
                  </p>
                )}
                {readySources.map((s) => {
                  const checked = chat.selectedSourceIds.includes(s._id);
                  return (
                    <button
                      key={s._id}
                      type="button"
                      onClick={() => {
                        const next = checked
                          ? chat.selectedSourceIds.filter((x) => x !== s._id)
                          : [...chat.selectedSourceIds, s._id];
                        void updateChat({
                          chatId,
                          selectedSourceIds: next,
                        });
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-secondary"
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded border",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input",
                        )}
                      >
                        {checked && <BookOpenCheck className="size-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {s.name}
                        </span>
                        {s.subject && (
                          <span className="block text-xs text-muted-foreground">
                            {s.subject}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          {/* Source mode toggle */}
          <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5">
            <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
              Sources only
            </span>
            <Switch
              checked={sourceModeOn}
              onCheckedChange={(v) =>
                void updateChat({ chatId, sourceMode: v })
              }
              aria-label="Only use my sources"
            />
          </label>
        </header>

        {/* Messages */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
            {sourceModeOn && messages.length === 0 && (
              <div className="mx-auto flex max-w-md items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
                <BookOpenCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  <strong className="text-foreground">
                    Source Mode is on.
                  </strong>{" "}
                  Lumen will answer only from your selected sources and cite
                  them. If they don't cover it, you'll be asked before any
                  outside knowledge is used.
                </span>
              </div>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m._id} content={m.content} />
              ) : (
                <AssistantBubble
                  key={m._id}
                  message={m}
                  allowingOutside={allowingOutside}
                  regrounding={regrounding}
                  onAllowOutside={() =>
                    void send(
                      "Please answer my previous question using outside knowledge.",
                      true,
                    )
                  }
                  onReground={() => void handleReground()}
                />
              ),
            )}
            {pending && lastUserContent !== pending && (
              <UserBubble content={pending} pending />
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-border/70 bg-background/80 p-3 backdrop-blur">
          <div className="mx-auto max-w-3xl">
            {messages.length <= 1 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {STARTERS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    disabled={!!pending}
                    onClick={() => void send(s.prompt)}
                    className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring/30">
                <Textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (draft.trim() && !pending) handleSubmit(e);
                    }
                  }}
                  placeholder={
                    sourceModeOn
                      ? "Ask about anything in your sources…"
                      : "Ask Lumen anything from your syllabus…"
                  }
                  rows={1}
                  className="max-h-40 min-h-[38px] resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="size-9 shrink-0 rounded-xl"
                  disabled={!draft.trim() || !!pending}
                  aria-label="Send"
                >
                  <Send className="size-4" />
                </Button>
              </div>
              <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                {sourceModeOn
                  ? "Sources only — answers are grounded in your uploads with citations."
                  : "General mode — switch on “Sources only” to ground answers in your uploads."}
                {sourceModeOn && quota &&
                  ` ${quota.limit - quota.used} of ${quota.limit} source-checked answers left this week${quota.used >= quota.limit ? ` — resets in ${formatResetIn(quota.resetsInMs)}` : ""}.`}
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Tutor() {
  const { chatId } = useParams<{ chatId: string }>();

  return (
    <AppShell maxWidth="max-w-none">
      <div className="flex h-[calc(100dvh-3.5rem)] md:h-dvh">
        {chatId ? (
          <ChatView chatId={chatId as Id<"chats">} />
        ) : (
          <div className="min-w-0 flex-1 overflow-y-auto">
            <StartScreen />
          </div>
        )}
      </div>
    </AppShell>
  );
}
