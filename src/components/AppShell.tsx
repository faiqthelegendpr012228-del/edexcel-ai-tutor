import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  Layers,
  LayoutDashboard,
  Lightbulb,
  LibraryBig,
  LogOut,
  MessagesSquare,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-amber-500 text-primary-foreground shadow-sm">
        <Lightbulb className="size-4.5" strokeWidth={2.2} />
      </span>
      {!compact && (
        <span className="font-display text-lg font-semibold tracking-tight text-foreground">
          Lumen
        </span>
      )}
    </span>
  );
}

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/tutor", label: "Tutor", icon: MessagesSquare },
  { to: "/flashcards", label: "Flashcards", icon: Layers },
  { to: "/sources", label: "Sources", icon: LibraryBig },
] as const;

export function AppShell({
  children,
  maxWidth = "max-w-6xl",
}: {
  children: ReactNode;
  maxWidth?: string;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/");
    } catch (err) {
      console.error("Sign out failed:", err);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border/70 bg-sidebar md:flex">
        <div className="px-5 pt-5">
          <NavLink to="/dashboard" aria-label="Lumen home">
            <Wordmark />
          </NavLink>
        </div>
        <nav className="mt-8 flex flex-col gap-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto p-4">
          <div className="rounded-xl border border-sidebar-border bg-card p-3">
            <p className="truncate text-sm font-medium text-foreground">
              {user?.name || user?.email || "Student"}
            </p>
            {user?.email && (
              <p className="truncate text-xs text-muted-foreground">
                {user.email}
              </p>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="mt-2 h-8 w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
            >
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-border/70 bg-background/95 px-4 py-2.5 backdrop-blur md:hidden">
        <NavLink to="/dashboard" aria-label="Lumen home">
          <Wordmark compact />
        </NavLink>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex size-9 items-center justify-center rounded-lg transition-colors",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
              aria-label={item.label}
            >
              <item.icon className="size-4.5" />
            </NavLink>
          ))}
          <Button
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground"
            onClick={handleSignOut}
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </nav>
      </div>

      <main className="min-w-0 flex-1 pb-16 pt-14 md:pb-0 md:pt-0">
        <div className={cn("mx-auto w-full", maxWidth)}>{children}</div>
      </main>
    </div>
  );
}
