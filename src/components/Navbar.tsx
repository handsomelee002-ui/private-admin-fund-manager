export function Navbar() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-x-4 border-b border-border/50 bg-background/80 backdrop-blur-sm px-6 shadow-sm">
      <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
        <div className="flex flex-1"></div>
        <div className="flex items-center gap-x-4 lg:gap-x-6">
          <div className="hidden lg:block lg:h-6 lg:w-px lg:bg-border" aria-hidden="true" />
          <div className="flex items-center gap-x-4">
            <span className="text-sm font-semibold leading-6 text-foreground">Admin</span>
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
              A
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
