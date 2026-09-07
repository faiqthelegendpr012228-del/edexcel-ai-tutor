import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import {
  QUALIFICATIONS,
  findQualification,
  findSubject,
} from "@/lib/curriculum";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  CalendarDays,
  Check,
  LibraryBig,
  MessagesSquare,
  Plus,
  Target,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

const GRADES_ALEVEL = ["A*", "A", "B", "C", "D", "E"] as const;
const GRADES_GCSE = ["9", "8", "7", "6", "5", "4"] as const;

function Onboarding() {
  const upsertProfile = useMutation(api.profiles.upsertProfile);
  const [step, setStep] = useState(0);
  const [qualification, setQualification] = useState("");
  const [subject, setSubject] = useState("");
  const [targetGrade, setTargetGrade] = useState("");
  const [examDate, setExamDate] = useState("");
  const [saving, setSaving] = useState(false);

  const qual = findQualification(qualification);
  const grades = qual && (qual.id === "gcse" || qual.id === "igcse")
    ? GRADES_GCSE
    : GRADES_ALEVEL;

  const finish = async () => {
    setSaving(true);
    try {
      await upsertProfile({
        qualification: qualification || undefined,
        subject: subject || undefined,
        targetGrade: targetGrade || undefined,
        examDate: examDate ? new Date(examDate).getTime() : undefined,
        onboarded: true,
      });
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-xl border-border/70 shadow-sm">
        <CardContent className="p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-2">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  i <= step ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>

          {step === 0 && (
            <>
              <h2 className="font-display text-xl font-semibold">
                Which qualification are you studying?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Lumen aligns every explanation with the exact Edexcel spec.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {QUALIFICATIONS.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      setQualification(q.id);
                      setSubject("");
                      setStep(1);
                    }}
                    className={cn(
                      "rounded-xl border p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/50",
                      qualification === q.id && "border-primary bg-primary/5",
                    )}
                  >
                    <p className="text-sm font-semibold">{q.shortName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {q.subjects.length} subjects
                    </p>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="font-display text-xl font-semibold">
                Your focus subject
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {qual?.name} — you can study anything later, this just
                personalises your dashboard.
              </p>
              <div className="mt-4 grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {qual?.subjects.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSubject(s.id);
                      setStep(2);
                    }}
                    className={cn(
                      "rounded-xl border p-3 text-left text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent/50",
                      subject === s.id && "border-primary bg-primary/5",
                    )}
                  >
                    {s.name}
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {s.topics.length} topics
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="font-display text-xl font-semibold">
                Set your target
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Optional — Lumen uses it to pitch explanations and feedback.
              </p>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="mb-2 text-sm font-medium">Target grade</p>
                  <div className="flex flex-wrap gap-2">
                    {grades.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setTargetGrade(g)}
                        className={cn(
                          "size-10 rounded-lg border text-sm font-semibold transition-colors hover:border-primary/40",
                          targetGrade === g &&
                            "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">Exam date</p>
                  <Input
                    type="date"
                    value={examDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setExamDate(e.target.value)}
                    className="w-full sm:w-56"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button onClick={() => void finish()} disabled={saving}>
                    {saving ? "Saving…" : "Start learning"}
                    {!saving && <ArrowRight className="size-4" />}
                  </Button>
                  <Button variant="ghost" onClick={() => void finish()}>
                    Skip for now
                  </Button>
                </div>
              </div>
            </>
          )}

          {step > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-4 -ml-2 text-muted-foreground"
              onClick={() => setStep(step - 1)}
            >
              Back
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Target;
  label: string;
  value: string;
}) {
  return (
    <Card className="border-border/70 shadow-none">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
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

function DashboardContent() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const profile = useQuery(api.profiles.getMyProfile);
  const chats = useQuery(api.chats.listChats);
  const sources = useQuery(api.sources.listSources);

  const readySources = useMemo(
    () => (sources ?? []).filter((s) => s.status === "ready"),
    [sources],
  );

  const qual = profile?.qualification
    ? findQualification(profile.qualification)
    : undefined;
  const subject =
    profile?.qualification && profile?.subject
      ? findSubject(profile.qualification, profile.subject)
      : undefined;

  const daysToExam = profile?.examDate
    ? Math.ceil((profile.examDate - Date.now()) / 86_400_000)
    : undefined;

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = user?.name?.split(" ")[0];

  const isLoading = profile === undefined || chats === undefined;

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-8 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting}
            {name ? `, ${name}` : ""}.
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {qual
              ? `${qual.shortName}${subject ? ` · ${subject.name}` : ""}`
              : "Your personal Edexcel tutor"}
            {profile?.targetGrade ? ` · aiming for ${profile.targetGrade}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate("/tutor")} className="gap-2">
            <Plus className="size-4" />
            New lesson
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/sources")}
            className="gap-2"
          >
            <LibraryBig className="size-4" />
            Sources
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={MessagesSquare}
          label="Lessons"
          value={String(chats?.length ?? 0)}
        />
        <StatCard
          icon={LibraryBig}
          label="Sources ready"
          value={String(readySources.length)}
        />
        <StatCard
          icon={Target}
          label="Target grade"
          value={profile?.targetGrade ?? "—"}
        />
        <StatCard
          icon={CalendarDays}
          label={daysToExam !== undefined ? "Days to exam" : "Exam date"}
          value={
            daysToExam !== undefined
              ? String(Math.max(daysToExam, 0))
              : profile?.examDate
                ? new Date(profile.examDate).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })
                : "—"
          }
        />
      </div>

      {/* Primary CTA */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary to-indigo-900 p-6 text-primary-foreground shadow-lg sm:p-8">
        <div className="absolute inset-0 glow-lamp opacity-60" />
        <div className="relative">
          <h2 className="font-display text-xl font-semibold sm:text-2xl">
            Turn a hard topic into an easy one tonight.
          </h2>
          <p className="mt-1 max-w-lg text-sm text-primary-foreground/80">
            Lumen teaches step by step, quizzes you with exam-style questions,
            and can ground every answer in your own textbook — cited by page.
          </p>
          <Button
            size="lg"
            variant="secondary"
            className="mt-4 gap-2"
            onClick={() => navigate("/tutor")}
          >
            Start a lesson
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent lessons */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Recent lessons
            </h3>
            {(chats?.length ?? 0) > 0 && (
              <Link
                to="/tutor"
                className="text-xs font-medium text-primary hover:underline"
              >
                View all
              </Link>
            )}
          </div>
          <div className="rounded-2xl border bg-card">
            {(chats?.length ?? 0) === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No lessons yet. Your conversations with Lumen will appear here.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {chats!.slice(0, 5).map((chat) => (
                  <li key={chat._id}>
                    <Link
                      to={`/tutor/${chat._id}`}
                      className="flex items-center gap-3 p-3.5 transition-colors hover:bg-secondary/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {chat.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {chat.subject ?? "General"} ·{" "}
                          {formatDistanceToNow(chat.updatedAt, {
                            addSuffix: true,
                          })}
                        </p>
                      </div>
                      {chat.sourceMode && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          sources
                        </Badge>
                      )}
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Sources */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Your sources
            </h3>
            <Link
              to="/sources"
              className="text-xs font-medium text-primary hover:underline"
            >
              Manage
            </Link>
          </div>
          <div className="rounded-2xl border bg-card">
            {readySources.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No sources yet — upload your textbook or notes to unlock
                  cited, source-only answers.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-2"
                  onClick={() => navigate("/sources")}
                >
                  <LibraryBig className="size-4" />
                  Upload sources
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {readySources.slice(0, 5).map((s) => (
                  <li key={s._id} className="flex items-center gap-3 p-3.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-600/15 text-emerald-600 dark:text-emerald-400">
                      <Check className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      {s.subject && (
                        <p className="text-xs text-muted-foreground">
                          {s.subject}
                        </p>
                      )}
                    </div>
                    {s.pageCount && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {s.pageCount}p
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const profile = useQuery(api.profiles.getMyProfile);
  const needsOnboarding = profile !== undefined && !profile;

  return (
    <AppShell>
      {needsOnboarding ? <Onboarding /> : <DashboardContent />}
    </AppShell>
  );
}
