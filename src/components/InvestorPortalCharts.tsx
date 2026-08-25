"use client";

import { useEffect, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

type ValuePoint = {
  weekEnding: string;
  navPerUnit: number;
  marketValue: number;
  netInvested: number;
};

const AXIS_COLOR = "oklch(0.7 0.05 250)";
const GRID_COLOR = "oklch(0.3 0.03 250 / 0.35)";

const TOOLTIP_STYLE = {
  background: "oklch(0.15 0.02 250)",
  border: "1px solid oklch(0.25 0.04 250)",
  borderRadius: "8px",
  color: "oklch(0.98 0.01 250)",
  fontSize: "12px",
} as const;

function money(value: number) {
  return `RM ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compactMoney(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value));
}

/**
 * Recharts' ResponsiveContainer measures to zero inside a grid cell that has not
 * been laid out yet, which renders an empty chart that never recovers. Measure
 * the wrapper ourselves, same as PlatformCharts does.
 */
function ChartFrame({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height - 16)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="h-[260px] min-h-[260px] w-full min-w-0 pt-4">
      {size.width > 0 && size.height > 0 ? children(size) : null}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">{message}</div>
  );
}

/** The investor's holding value against what they put in. */
export function InvestorValueChart({ data }: { data: ValuePoint[] }) {
  if (!data || data.length === 0) return <EmptyState message="No valuation history yet." />;

  return (
    <ChartFrame>
      {({ width, height }) => (
        <AreaChart width={width} height={height} data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="investorValueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="weekEnding" tick={{ fontSize: 10, fill: AXIS_COLOR }} minTickGap={48} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: AXIS_COLOR }} tickFormatter={compactMoney} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: unknown, name: unknown) => [money(Number(value)), name === "marketValue" ? "Value" : "Invested"]}
          />
          <Area type="monotone" dataKey="marketValue" stroke="#6366f1" strokeWidth={2} fill="url(#investorValueFill)" />
          {/* Cost basis as a flat reference: the gap between the two lines is
              the gain or loss, which is the thing worth reading here. */}
          <Line type="monotone" dataKey="netInvested" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
        </AreaChart>
      )}
    </ChartFrame>
  );
}

/** Fund-level unit price. No individual investor's data is in this series. */
export function FundNavChart({ data }: { data: { weekEnding: string; navPerUnit: number }[] }) {
  if (!data || data.length === 0) return <EmptyState message="No locked NAV history yet." />;

  return (
    <ChartFrame>
      {({ width, height }) => (
        <LineChart width={width} height={height} data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="weekEnding" tick={{ fontSize: 10, fill: AXIS_COLOR }} minTickGap={48} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: AXIS_COLOR }}
            tickFormatter={(value: number) => Number(value).toFixed(2)}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: unknown) => [Number(value).toFixed(6), "NAV / unit"]}
          />
          <Line type="monotone" dataKey="navPerUnit" stroke="#10b981" strokeWidth={2} dot={false} />
        </LineChart>
      )}
    </ChartFrame>
  );
}
