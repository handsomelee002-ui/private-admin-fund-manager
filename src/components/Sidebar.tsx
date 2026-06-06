"use client";

import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Wallet,
  ArrowRightLeft,
  Settings,
  BarChart2,
  Building2,
  CalendarClock,
  Database,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NoPrefetchLink } from "@/components/NoPrefetchLink";

const navigation = [
  { name: "Dashboard",      href: "/",        icon: LayoutDashboard, exact: true },
  { name: "Platforms",      href: "/trading", icon: Building2,        exact: false },
  { name: "Weekly NAV",     href: "/nav",     icon: CalendarClock,   exact: false },
  { name: "Capital",        href: "/capital",  icon: ArrowRightLeft,  exact: false },
  { name: "Investors",      href: "/investors", icon: Users,           exact: false },
  { name: "Fixed Savings",  href: "/fixed-savings", icon: Wallet,      exact: false },
  { name: "Savings Rates",  href: "/fixed-savings-rates", icon: CalendarClock, exact: false },
  { name: "Reports",        href: "/reports",  icon: BarChart2,       exact: false },
  { name: "Admin Logs",     href: "/admin-logs", icon: ShieldCheck,    exact: false },
  { name: "Brokerage",      href: "/brokerage", icon: Settings,       exact: false },
  { name: "Settings",       href: "/settings", icon: Database,        exact: false },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="admin-sidebar flex h-screen shrink-0 flex-col border-r border-border/50 bg-card/50 backdrop-blur-xl transition-all duration-300">
      <div className="admin-sidebar-logo flex h-16 shrink-0 items-center">
        <div className="flex items-center gap-2 font-bold text-lg text-primary">
          <Wallet className="h-6 w-6" />
          <span className="admin-sidebar-label">FundManager</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto pt-6">
        <nav className="admin-sidebar-nav flex-1 space-y-1">
          {navigation.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <NoPrefetchLink
                key={item.name}
                href={item.href}
                className={cn(
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  "admin-sidebar-link group flex items-center rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200"
                )}
                title={item.name}
              >
                <item.icon
                  className={cn(
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                    "admin-sidebar-icon h-5 w-5 shrink-0 transition-colors"
                  )}
                  aria-hidden="true"
                />
                <span className="admin-sidebar-label">{item.name}</span>
              </NoPrefetchLink>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
