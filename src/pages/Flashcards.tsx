import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  Check,
  Flame,
  Layers,
  MessagesSquare,
  RotateCcw,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type Flashcard = Doc<"flashcards">;

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function BoxDots({ card }: { card: Flashcard }) {
  return (
    <span className="flex items-center gap-1" title={`Leitner box ${card.box + 1} of 6`}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            "size-1.5 rounded-full",
            card.mastered
              ? "bg-emerald-500"
              : i <= card.box
                ? "bg-primary"
                : "bg-border",
          )}
        />
      ))}
    </span>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Zap;
  label: string;
  value: string | number;
  tone?: "default" | "amber" | "green";
}) {
  return (
    <Card className="border-border/70 shadow-none">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            tone === "amber" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
            tone === "green" && "bg-emerald-600/15 text-emerald-600 dark:text-emerald-400",
            tone === "default" && "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold leading-6">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Review session
// ---------------------------------------------------------------------------

function ReviewSession({
  cards,
  dueCount,
  onStartNew,
}: {
  cards: Flashcard[];
  dueCount: number;
  onStartNew: () => void;
}) {
  const reviewCard = useMutation(api.practice.reviewCard);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  const card = cards[index];
  const done = index >= cards.length;
  const total = cards.length;

  const review = (result: "again" | "gotit") => {
    if (!card || busy) return;
    setBusy(true);
    reviewCard({ cardId: card._id, result })
      .catch(() => toast.error("Couldn't save that review — try again."))
      .finally(() => {
        setIndex((i) => i + 1);
        setRevealed(false);
        setBusy(false);
      });
  };

  // Keyboard: Space = flip, 1 = again, 2 = got it.
  useEffect(() => {
    if (done) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setRevealed((r) => !r);
      } else if (e.key === "1" && revealed) {
        review("again");
      } else if ((e.key === "2" || e.key === "Enter") && revealed) {
        review("gotit");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, revealed, card?._id, busy]);

  if (done) {
    return (
      <div className="flex flex-col items-center rounded-2xl border bg-card p-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-emerald-600/15 text-emerald-600 dark:text-emerald-400">
          <Check className="size-6" />
        </div>
        <p className="mt-3 font-display text-lg font-semibold">Session complete</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          You reviewed {total} card{total === 1 ? "" : "s"}. Cards you knew come
          back later — the ones you didn't will return shortly.
        </p>
        {dueCount > 0 && (
          <Button className="mt-5 gap-2" onClick={onStartNew}>
            <RotateCcw className="size-4" />
            Review {dueCount} more
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Progress
          value={(index / total) * 100}
          className="h-1.5 flex-1"
          aria-label="Session progress"
        />
        <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
          {index + 1} / {total}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="group relative flex min-h-[220px] w-full flex-col rounded-2xl border bg-card p-6 text-left shadow-sm transition-shadow hover:shadow-md sm:p-8"
      >
        <span className="absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {revealed ? "Answer" : "Question"}
          {card?.subject ? ` · ${card.subject}` : ""}
        </span>
        <span className="mt-3 flex-1 text-balance font-display text-lg font-medium leading-8 sm:text-xl">
          {revealed ? card?.back : card?.front}
        </span>
        {!revealed && (
          <span className="mt-4 text-xs text-muted-foreground">
            Click to reveal — or press Space
          </span>
        )}
      </button>

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1 gap-2"
          disabled={!revealed || busy}
          onClick={() => review("again")}
        >
          <RotateCcw className="size-4" />
          Again
          <kbd className="ml-1 hidden rounded border bg-muted px-1 text-[10px] text-muted-foreground sm:inline">
            1
          </kbd>
        </Button>
        <Button
          className="flex-1 gap-2"
          disabled={!revealed || busy}
          onClick={() => review("gotit")}
        >
          <Check className="size-4" />
          Got it
          <kbd className="ml-1 hidden rounded border border-primary-foreground/30 px-1 text-[10px] text-primary-foreground/80 sm:inline">
            2
          </kbd>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse-all card
// ---------------------------------------------------------------------------

function AllCard({
  card,
  onDelete,
}: {
  card: Flashcard;
  onDelete: (id: Flashcard["_id"]) => void;
}) {
  const dueNow = card.nextDueAt <= Date.now();
  return (
    <div className="flex flex-col rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <p className="text-sm font-medium leading-6">{card.front}</p>
      <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-muted-foreground">
        {card.back}
      </p>
      <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
        <BoxDots card={card} />
        <Badge
          variant="secondary"
          className="ml-auto text-[10px] font-normal"
        >
          {card.mastered
            ? "Mastered"
            : dueNow
              ? "Due now"
              : `Due ${formatDistanceToNow(card.nextDueAt, { addSuffix: true })}`}
        </Badge>
        <button
          type="button"
          aria-label="Delete card"
          onClick={() => onDelete(card._id)}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Flashcards() {
  const stats = useQuery(api.practice.getStats);
  const due = useQuery(api.practice.listDue);
  const all = useQuery(api.practice.listAll);
  const deleteCard = useMutation(api.practice.deleteCard);

  // Snapshot the due queue when a session starts so reactive updates don't
  // reshuffle mid-session.
  const [session, setSession] = useState<Flashcard[] | null>(null);

  const dueCards = useMemo(() => due ?? [], [due]);

  const startSession = () => setSession(dueCards.slice());

  // Fresh cards arrive (e.g. generated in a lesson) → start automatically.
  useEffect(() => {
    if (session === null && dueCards.length > 0) {
      setSession(dueCards.slice());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueCards.length, session === null]);

  const handleDelete = async (id: Flashcard["_id"]) => {
    try {
      await deleteCard({ cardId: id });
      setSession((s) => (s ? s.filter((c) => c._id !== id) : s));
      toast.success("Card deleted.");
    } catch {
      toast.error("Couldn't delete that card.");
    }
  };

  const loading = stats === undefined || due === undefined || all === undefined;

  return (
    <AppShell>
      <div className="px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Flashcards
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Spaced repetition on everything Lumen has taught you. Cards you
            recall well resurface later; the tricky ones come back sooner.
          </p>
        </header>

        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (all ?? []).length === 0 ? (
          // Empty state — guide the student into the generation flow.
          <div className="mx-auto max-w-xl rounded-2xl border bg-card p-8 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-amber-500 text-primary-foreground shadow-lg">
              <Layers className="size-6" />
            </div>
            <p className="mt-4 font-display text-lg font-semibold">
              No flashcards yet
            </p>
            <ol className="mx-auto mt-4 max-w-sm space-y-2 text-left text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">1.</span>
                Start a lesson and learn a topic with Lumen.
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">2.</span>
                Under any answer, press “Make flashcards”.
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">3.</span>
                Come back here to review — Lumen schedules each card for you.
              </li>
            </ol>
            <Button asChild className="mt-5 gap-2">
              <Link to="/tutor">
                <MessagesSquare className="size-4" />
                Start a lesson
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-3 gap-3">
              <StatTile
                icon={Zap}
                label="Due now"
                value={stats?.due ?? 0}
                tone={(stats?.due ?? 0) > 0 ? "amber" : "default"}
              />
              <StatTile icon={Layers} label="Total cards" value={stats?.total ?? 0} />
              <StatTile
                icon={Flame}
                label="Mastered"
                value={stats?.mastered ?? 0}
                tone="green"
              />
            </div>

            <section>
              {session && session.length > 0 ? (
                <ReviewSession
                  cards={session}
                  dueCount={stats?.due ?? 0}
                  onStartNew={startSession}
                />
              ) : (stats?.due ?? 0) > 0 && session === null ? (
                <div className="flex flex-col items-center rounded-2xl border bg-card p-8 text-center">
                  <Sparkles className="size-5 text-amber-500" />
                  <p className="mt-2 text-sm font-medium">
                    {stats?.due} card{(stats?.due ?? 0) === 1 ? " is" : "s are"} due for review
                  </p>
                  <Button className="mt-4 gap-2" onClick={startSession}>
                    Start review
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center rounded-2xl border bg-card p-8 text-center">
                  <Check className="size-5 text-emerald-600 dark:text-emerald-400" />
                  <p className="mt-2 text-sm font-medium">
                    {session
                      ? "All caught up."
                      : "Nothing due right now."}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {stats?.nextDueAt
                      ? `Next card due ${formatDistanceToNow(stats.nextDueAt, { addSuffix: true })}.`
                      : "Generate new cards from any lesson answer."}
                  </p>
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                All cards
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(all ?? []).map((card) => (
                  <AllCard key={card._id} card={card} onDelete={(id) => void handleDelete(id)} />
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
