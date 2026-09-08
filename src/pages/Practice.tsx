import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { QUALIFICATIONS } from "@/lib/curriculum";
import { useAction, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardList,
  ListChecks,
  Plus,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

type QuizSet = Doc<"quizSets">;
type QuizQuestion = Doc<"quizQuestions">;

const DIFFICULTIES = [
  { id: "foundation", label: "Foundation", hint: "Build confidence" },
  { id: "standard", label: "Standard", hint: "Exam-level mix" },
  { id: "stretch", label: "Stretch", hint: "Top-grade challenge" },
] as const;

// ---------------------------------------------------------------------------
// Setup: choose subject + difficulty, generate a paper
// ---------------------------------------------------------------------------

function Setup({ onCreated }: { onCreated: (id: Id<"quizSets">) => void }) {
  const { user } = useAuth();
  const profile = useQuery(api.profiles.getMyProfile);
  const past = useQuery(api.quiz.listQuizSets);
  const deleteQuiz = useMutation(api.quiz.deleteQuiz);
  const generateQuiz = useAction(api.quiz.generateQuiz);

  const [qualification, setQualification] = useState("");
  const [subject, setSubject] = useState("");
  const [difficulty, setDifficulty] = useState<string>("standard");
  const [count, setCount] = useState(5);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!qualification && profile?.qualification) {
      setQualification(profile.qualification);
      setSubject(profile.subject ?? "");
    }
  }, [profile, qualification]);

  const qual = QUALIFICATIONS.find((q) => q.id === qualification);
  const subjects = qual?.subjects ?? [];

  const start = async () => {
    if (!qual) return;
    const subj = subjects.find((s) => s.id === subject);
    if (!subj) return;
    setCreating(true);
    try {
      const { quizSetId } = await generateQuiz({
        subject: subj.name,
        qualification: qual.shortName,
        difficulty: difficulty as "foundation" | "standard" | "stretch",
        count,
      });
      onCreated(quizSetId);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't generate the paper.",
      );
      setCreating(false);
    }
  };

  const pastPapers = past ?? [];

  return (
    <div className="px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Exam practice
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate an exam-style paper, answer it, and get examiner-style
          marking with point-by-point feedback.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="border-border/70 lg:col-span-3">
          <CardContent className="p-5">
            <p className="mb-3 text-sm font-medium">Build your paper</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={qualification}
                onChange={(e) => {
                  setQualification(e.target.value);
                  setSubject("");
                }}
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
              >
                <option value="" disabled>
                  Qualification
                </option>
                {QUALIFICATIONS.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.shortName}
                  </option>
                ))}
              </select>
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={!qualification}
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm disabled:opacity-50"
              >
                <option value="" disabled>
                  Subject
                </option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <p className="mb-2 mt-4 text-sm font-medium">Difficulty</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDifficulty(d.id)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors hover:border-primary/40",
                    difficulty === d.id && "border-primary bg-primary/5",
                  )}
                >
                  <p className="text-sm font-semibold">{d.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {d.hint}
                  </p>
                </button>
              ))}
            </div>

            <p className="mb-2 mt-4 text-sm font-medium">Questions</p>
            <div className="flex flex-wrap gap-2">
              {[3, 5, 8].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={cn(
                    "size-10 rounded-lg border text-sm font-semibold transition-colors hover:border-primary/40",
                    count === n && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>

            <Button
              className="mt-5 w-full gap-2 sm:w-auto"
              disabled={!qualification || !subject || creating}
              onClick={() => void start()}
            >
              {creating ? (
                <>
                  <Sparkles className="size-4 animate-pulse" />
                  Writing your paper…
                </>
              ) : (
                <>
                  <Plus className="size-4" />
                  Generate paper
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent papers
          </p>
          {pastPapers.length === 0 ? (
            <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
              No papers yet. Generate your first one and your scores will
              appear here.
            </div>
          ) : (
            <div className="space-y-2">
              {pastPapers.slice(0, 6).map((p) => (
                <div
                  key={p._id}
                  className="group flex items-center gap-3 rounded-xl border bg-card p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.subject}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[p.qualification, p.topic].filter(Boolean).join(" · ") ||
                        "Mixed topics"}
                      {" · "}
                      {formatDistanceToNow(p.updatedAt, { addSuffix: true })}
                    </p>
                  </div>
                  {p.status === "complete" && p.score !== undefined ? (
                    <Badge
                      variant="secondary"
                      className={cn(
                        "shrink-0 tabular-nums",
                        p.score >= 70 && "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
                        p.score < 40 && "bg-destructive/10 text-destructive",
                      )}
                    >
                      {p.score}%
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      In progress
                    </Badge>
                  )}
                  <button
                    type="button"
                    aria-label="Delete paper"
                    onClick={() => {
                      void deleteQuiz({ quizSetId: p._id }).catch(() =>
                        toast.error("Couldn't delete the paper."),
                      );
                    }}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback panel for a marked question
// ---------------------------------------------------------------------------

function FeedbackPanel({ question }: { question: QuizQuestion }) {
  const feedback = question.feedback ?? [];
  const earned = question.earnedMarks ?? 0;
  const total = question.marks;
  const pct = total > 0 ? earned / total : 0;

  return (
    <div className="mt-4 space-y-3 rounded-xl border bg-background/60 p-4">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
            pct >= 0.8
              ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
              : pct >= 0.4
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "bg-destructive/10 text-destructive",
          )}
        >
          {earned} / {total} marks
        </span>
        <span className="text-xs text-muted-foreground">
          Examiner feedback
        </span>
      </div>

      <ul className="space-y-2">
        {feedback.map((f, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-6">
            <span
              className={cn(
                "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full",
                f.awarded
                  ? "bg-emerald-600/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {f.awarded ? (
                <Check className="size-3" />
              ) : (
                <X className="size-3" />
              )}
            </span>
            <span className="min-w-0">
              <span className="font-medium">{f.point}</span>
              {f.pointType && f.pointType !== "content" && (
                <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {f.pointType}
                </span>
              )}
              {f.comment && (
                <span className="block text-muted-foreground">{f.comment}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {question.overallComment && (
        <p className="border-t border-border/60 pt-3 text-sm leading-6 text-muted-foreground">
          <span className="font-medium text-foreground">Next time: </span>
          {question.overallComment}
        </p>
      )}

      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-primary hover:underline">
          Show the marking guide
        </summary>
        <div className="mt-2 whitespace-pre-wrap rounded-lg border bg-card p-3 text-xs leading-5 text-muted-foreground">
          {question.modelAnswer}
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paper runner: one question at a time
// ---------------------------------------------------------------------------

function PaperRunner({
  quizSetId,
  onExit,
}: {
  quizSetId: Id<"quizSets">;
  onExit: () => void;
}) {
  const navigate = useNavigate();
  const data = useQuery(api.quiz.getQuizSet, { quizSetId });
  const answerQuestion = useAction(api.quiz.answerQuestion);
  const completeQuiz = useMutation(api.quiz.completeQuiz);

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const set = data?.set;
  const questions = useMemo(() => data?.questions ?? [], [data]);
  const answeredCount = questions.filter(
    (q) => q.studentAnswer !== undefined,
  ).length;
  const current = questions.find((q) => q.studentAnswer === undefined);
  const done = set !== undefined && current === undefined && questions.length > 0;

  // Total marks across the paper for the progress bar.
  const totalMarks = questions.reduce((s, q) => s + q.marks, 0);
  const earnedSoFar = questions.reduce(
    (s, q) => s + (q.earnedMarks ?? 0),
    0,
  );

  const submit = async () => {
    if (!current || submitting) return;
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      await answerQuestion({ questionId: current._id, answer: draft });
      setDraft("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't mark that answer.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const finish = async () => {
    if (!set || finishing) return;
    setFinishing(true);
    try {
      const result = await completeQuiz({ quizSetId });
      toast.success(
        `Paper complete — ${result.earned}/${result.totalMarks} marks (${result.score}%).`,
      );
    } catch {
      toast.error("Couldn't finalise the paper.");
    } finally {
      setFinishing(false);
    }
  };

  if (data === undefined) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
        Loading paper…
      </div>
    );
  }
  if (!set) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">
          This paper doesn't exist or was deleted.
        </p>
        <Button variant="outline" onClick={onExit}>
          <ArrowLeft className="size-4" />
          Back to Exam practice
        </Button>
      </div>
    );
  }

  const questionNumber = current
    ? questions.indexOf(current) + 1
    : questions.length;

  return (
    <div className="px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onExit}
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {set.qualification ?? "Edexcel"} · {set.subject}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {set.topic ?? "Mixed topics"} ·{" "}
              {set.difficulty === "stretch"
                ? "Stretch"
                : set.difficulty === "foundation"
                  ? "Foundation"
                  : "Standard"}
            </p>
          </div>
          {done && set.status === "in_progress" && (
            <Button size="sm" disabled={finishing} onClick={() => void finish()}>
              {finishing ? "Scoring…" : "Finish paper"}
            </Button>
          )}
          {set.status === "complete" && set.score !== undefined && (
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              {set.score}%
            </Badge>
          )}
        </div>

        <Progress
          value={totalMarks > 0 ? (answeredCount / questions.length) * 100 : 0}
          className="mb-6 h-1.5"
          aria-label="Paper progress"
        />

        {done ? (
          <div className="flex flex-col items-center rounded-2xl border bg-card p-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-emerald-600/15 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-6" />
            </div>
            <p className="mt-3 font-display text-lg font-semibold">
              All questions answered
            </p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {set.status === "complete"
                ? `You scored ${earnedSoFar}/${totalMarks} on this paper.`
                : "Finish the paper to see your total score."}
            </p>
            {set.status === "complete" && (
              <Button className="mt-5 gap-2" onClick={onExit}>
                <ClipboardList className="size-4" />
                Back to Exam practice
              </Button>
            )}
          </div>
        ) : (
          current && (
            <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="shrink-0">
                  Question {questionNumber} of {questions.length}
                </Badge>
                <Badge variant="outline" className="shrink-0">
                  {current.marks} mark{current.marks === 1 ? "" : "s"}
                </Badge>
                {current.commandWord && (
                  <Badge
                    variant="outline"
                    className="shrink-0 text-[10px] uppercase tracking-wide"
                  >
                    {current.commandWord}
                  </Badge>
                )}
              </div>

              <p className="mt-4 whitespace-pre-wrap font-display text-lg font-medium leading-8">
                {current.question}
              </p>

              {current.studentAnswer === undefined ? (
                <>
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Write your answer as you would in the exam…"
                    rows={6}
                    className="mt-4 resize-y"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Lumen marks it point by point, like an examiner.
                    </p>
                    <Button
                      disabled={!draft.trim() || submitting}
                      onClick={() => void submit()}
                    >
                      {submitting ? "Marking…" : "Submit answer"}
                      {!submitting && <ArrowRight className="size-4" />}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-4 whitespace-pre-wrap rounded-xl border bg-background/60 p-4 text-sm leading-6">
                    {current.studentAnswer}
                  </div>
                  <FeedbackPanel question={current} />
                </>
              )}
            </div>
          )
        )}

        {/* Answered questions review */}
        {answeredCount > 0 && !done && (
          <div className="mt-6">
            <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Marked so far
            </p>
            <div className="space-y-2">
              {questions
                .filter((q) => q.studentAnswer !== undefined)
                .map((q) => (
                  <div
                    key={q._id}
                    className="flex items-center gap-3 rounded-xl border bg-card p-3"
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
                        (q.earnedMarks ?? 0) / q.marks >= 0.5
                          ? "bg-emerald-600/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {q.earnedMarks}/{q.marks}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-sm">
                      {q.question}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Practice() {
  const [activeId, setActiveId] = useState<Id<"quizSets"> | null>(null);

  return (
    <AppShell maxWidth="max-w-none">
      {activeId ? (
        <PaperRunner quizSetId={activeId} onExit={() => setActiveId(null)} />
      ) : (
        <Setup onCreated={(id) => setActiveId(id)} />
      )}
    </AppShell>
  );
}
