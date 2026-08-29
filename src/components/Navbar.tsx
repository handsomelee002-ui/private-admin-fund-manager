import { ThemeToggle } from "@/components/ThemeToggle";
import { logoutAdmin } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import type { SessionRole } from "@/lib/auth";

export function Navbar({ role = "admin" }: { role?: SessionRole }) {
  const isViewer = role === "viewer";
  return (
    <header className="flex h-16 shrink-0 items-center gap-x-4 border-b border-border/50 bg-background/80 backdrop-blur-sm px-6 shadow-sm">
      <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
        <div className="flex flex-1 items-center">
          {isViewer && (
            <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-500">
              Read-only view &mdash; changes are disabled
            </span>
          )}
        </div>
        <div className="flex items-center gap-x-4 lg:gap-x-6">
          <ThemeToggle />
          <div className="hidden lg:block lg:h-6 lg:w-px lg:bg-border" aria-hidden="true" />
          <div className="flex items-center gap-x-3">
            <span className="text-sm font-semibold leading-6 text-foreground">{isViewer ? "Viewer" : "Admin"}</span>
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
              {isViewer ? "V" : "A"}
            </div>
            <form action={logoutAdmin}>
              <Button type="submit" variant="outline" size="sm">Log out</Button>
            </form>
          </div>
        </div>
      </div>
    </header>
  );
}
