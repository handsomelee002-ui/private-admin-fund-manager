"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Wallet,
  ArrowRightLeft,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Investors", href: "/investors", icon: Users },
  { name: "Trading Ledger", href: "/trading", icon: ArrowRightLeft },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col border-r border-border/50 bg-card/50 backdrop-blur-xl transition-all duration-300">
      <div className="flex h-16 shrink-0 items-center px-6">
        <div className="flex items-center gap-2 font-bold text-lg text-primary">
          <Wallet className="h-6 w-6" />
          <span>FundManager</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto pt-6">
        <nav className="flex-1 space-y-1 px-4">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  "group flex items-center rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200"
                )}
              >
                <item.icon
                  className={cn(
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                    "mr-3 h-5 w-5 shrink-0 transition-colors"
                  )}
                  aria-hidden="true"
                />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
