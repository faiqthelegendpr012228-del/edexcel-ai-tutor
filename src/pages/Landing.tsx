import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Wordmark } from "@/components/AppShell";
import { QUALIFICATIONS } from "@/lib/curriculum";
import {
  ArrowRight,
  BookOpenCheck,
  Brain,
  Check,
  FileText,
  GraduationCap,
  Layers,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  Sparkles,
} from "lucide-react";
import { Link, useNavigate } from "react-router";

const FEATURES = [
  {
    icon: BookOpenCheck,
    title: "Sources-only mode",
    body: "Upload your textbook, notes and past papers. Lumen answers strictly from them — every claim cited with a page you can open.",
  },
  {
    icon: Brain,
    title: "Teaches, not tells",
    body: "Step-by-step explanations, worked examples and one check-question at a time. Understanding first, answers second.",
  },
  {
    icon: ListChecks,
    title: "Exam-style practice",
    body: "Quizzes marked like an examiner. Learn the command words — State, Explain, Evaluate — and how to earn every mark.",
  },
  {
    icon: MessageCircleQuestion,
    title: "Detects confusion",
    body: "Lumen notices when an idea isn't landing and automatically re-explains it a different way — analogy, visual or simpler terms.",
  },
  {
    icon: Layers,
    title: "Flashcards & revision notes",
    body: "Turn any lesson into concise revision notes or a flashcard deck, generated from what you actually studied.",
  },
  {
    icon: GraduationCap,
    title: "Exact Edexcel specs",
    body: "Every qualification mapped: International GCSE, GCSE, International AS/A and A Level, topic by topic.",
  },
] as const;

const STEPS = [
  {
    title: "Pick your syllabus",
    body: "Choose your qualification and subject — from Edexcel IGCSE Biology to A Level Further Maths.",
  },
  {
    title: "Add your sources",
    body: "Drop in your textbook PDF, class notes or past papers. Lumen reads and indexes every page.",
  },
  {
    title: "Learn for real",
    body: "Ask anything. Get taught step by step, quizzed, corrected — and cited back to the exact page.",
  },
] as const;

const FAQS = [
  {
    q: "Does Source Mode really stop the AI from using outside knowledge?",
    a: "Yes. When Sources only is on, Lumen answers exclusively from passages retrieved from your uploaded materials and cites them. If your sources don't cover the question, it says so clearly and asks permission before using general knowledge — it never silently blends the two.",
  },
  {
    q: "Which qualifications are supported?",
    a: "Pearson Edexcel International GCSE, GCSE, International AS, International A Level, AS and A Level — across Biology, Chemistry, Physics, Maths, Further Maths, Computer Science, Economics, Business, Psychology, English and Geography.",
  },
  {
    q: "What can I upload?",
    a: "PDFs, Word documents, PowerPoints and plain text or Markdown files — textbooks, revision guides, mark schemes, specification documents, your own notes. Each is chunked page by page so citations point at real pages.",
  },
  {
    q: "Is it just a chatbot with a nice interface?",
    a: "No. Lumen is built around a learning loop: understand, practise, get feedback, retain. Every lesson nudges you through that cycle instead of just answering questions.",
  },
] as const;

export default function Landing() {
  const navigate = useNavigate();

  const totalSubjects = QUALIFICATIONS.reduce(
    (n, q) => n + q.subjects.length,
    0,
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Wordmark />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#how" className="transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#faq" className="transition-colors hover:text-foreground">
              FAQ
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/auth">Start learning</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-dot-grid [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
        <div className="absolute inset-x-0 top-0 h-72 glow-lamp" />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-20 text-center sm:px-6 sm:pt-28">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Badge
              variant="outline"
              className="mb-5 gap-1.5 border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"
            >
              <Sparkles className="size-3.5" />
              Built for Pearson Edexcel students
            </Badge>
            <h1 className="mx-auto max-w-3xl font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
              The AI tutor that makes
              <span className="relative mx-2 inline-block">
                <span className="relative z-10 text-primary">hard topics</span>
                <span className="absolute inset-x-0 bottom-1 z-0 h-3 bg-amber-400/40" />
              </span>
              finally make sense
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
              Lumen teaches your exact Edexcel syllabus step by step — grounded
              in your own textbooks with page-cited answers, exam-style
              practice and revision that sticks.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="gap-2" asChild>
                <Link to="/auth">
                  Start learning free
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how">See how it works</a>
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
              {[
                "Sources-only answers with citations",
                "Every Edexcel qualification",
                "No credit card needed",
              ].map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-primary" />
                  {t}
                </span>
              ))}
            </div>
          </motion.div>

          {/* Hero mock: a source-cited answer */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="relative mx-auto mt-14 max-w-2xl"
          >
            <div className="absolute -inset-6 rounded-3xl bg-gradient-to-b from-amber-300/20 to-transparent blur-2xl" />
            <div className="relative rounded-2xl border bg-card p-5 text-left shadow-xl">
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-amber-500 text-primary-foreground">
                  <Lightbulb className="size-3.5" />
                </span>
                <span className="text-xs font-semibold">Lumen</span>
                <Badge variant="outline" className="ml-auto text-[10px]">
                  Sources only
                </Badge>
              </div>
              <div className="prose-lumen mt-3 text-sm">
                <p>
                  <strong>Why does enzyme activity drop above 40 °C?</strong>{" "}
                  The enzyme's tertiary structure is held together by hydrogen
                  bonds and ionic interactions. Heat gives molecules kinetic
                  energy until these bonds vibrate apart and the active site
                  loses its complementary shape — the enzyme is denatured.
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary">
                  <FileText className="size-3" />
                  Source: Biology Textbook, Page 143
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary">
                  <FileText className="size-3" />
                  Source: Edexcel Biology Spec, Topic 5
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-y border-border/60 bg-secondary/40">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-8 text-center sm:px-6 md:grid-cols-4">
          {[
            { value: `${QUALIFICATIONS.length}`, label: "Qualifications" },
            { value: `${totalSubjects}+`, label: "Subjects" },
            { value: "100+", label: "Mapped topics" },
            { value: "Page-level", label: "Citations" },
          ].map((s) => (
            <div key={s.label}>
              <p className="font-display text-2xl font-semibold text-primary sm:text-3xl">
                {s.value}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight">
            A learning environment, not a chatbot
          </h2>
          <p className="mt-3 text-muted-foreground">
            Everything is designed around one loop: understand, practise, get
            feedback, retain.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, delay: (i % 3) * 0.08 }}
              className="rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <f.icon className="size-5" />
              </div>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                {f.body}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-border/60 bg-secondary/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              Learning in three steps
            </h2>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="relative rounded-2xl border bg-card p-6">
                <span className="font-display text-4xl font-semibold text-primary/25">
                  {i + 1}
                </span>
                <h3 className="mt-2 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <h2 className="text-center font-display text-3xl font-semibold tracking-tight">
          Questions, answered
        </h2>
        <Accordion type="single" collapsible className="mt-8">
          {FAQS.map((f) => (
            <AccordionItem key={f.q} value={f.q}>
              <AccordionTrigger className="text-left text-base">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary to-indigo-950 px-6 py-14 text-center text-primary-foreground shadow-xl">
          <div className="absolute inset-0 glow-lamp opacity-70" />
          <div className="relative">
            <Lightbulb className="mx-auto size-8 text-amber-300" />
            <h2 className="mx-auto mt-4 max-w-xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Your personal tutor, on call 24/7
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-primary-foreground/80 sm:text-base">
              Start with any topic from your syllabus. Free to try — no credit
              card needed.
            </p>
            <Button
              size="lg"
              variant="secondary"
              className="mt-6 gap-2"
              onClick={() => navigate("/auth")}
            >
              Start learning free
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <Wordmark compact />
          <p>© {new Date().getFullYear()} Lumen · Built for Edexcel students</p>
        </div>
      </footer>
    </div>
  );
}
