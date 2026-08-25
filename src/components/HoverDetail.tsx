"use client";

import { useRef, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type HoverDetailProps = {
  /** The trigger. Server-rendered content is fine - it is passed as a child. */
  children: ReactNode;
  detail: ReactNode;
  /** Width of the popup. Wide panels need more than the w-72 default. */
  detailClassName?: string;
};

/**
 * Opens its detail on hover for pointer users and on click for everyone else -
 * hover alone is unreachable on touch.
 *
 * Deliberately does NOT open on focus. Base UI returns focus to the trigger when
 * the popup closes, so a focus handler re-opens it the instant it shuts and the
 * popup can never be dismissed. Keyboard users open it with Enter or Space,
 * which Popover.Trigger already handles as a button.
 *
 * Kept apart from the card it wraps so that only the cards that actually need a
 * popup ship any client JavaScript.
 */
export function HoverDetail({ children, detail, detailClassName }: HoverDetailProps) {
  const [open, setOpen] = useState(false);
  // Closing on mouseleave immediately makes the popup unreachable, since moving
  // the pointer towards it briefly leaves the trigger.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openNow() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function closeSoon() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        className="block h-full w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {children}
      </PopoverTrigger>
      <PopoverContent onMouseEnter={openNow} onMouseLeave={closeSoon} className={detailClassName}>
        {detail}
      </PopoverContent>
    </Popover>
  );
}
