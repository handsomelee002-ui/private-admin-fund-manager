"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";

const COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#3b82f6",
  "#ec4899", "#8b5cf6", "#14b8a6", "#f97316",
];

interface PlatformComparisonChartProps {
  platforms: { id: string; name: string; netInvested: number; unrealizedProfit: number; totalValue: number }[];
}

export function PlatformComparisonChart({ platforms }: PlatformComparisonChartProps) {
  if (platforms.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        No platform data available.
      </div>
    );
  }

  const data = platforms.map((p) => ({
    name: p.name,
    "Net Invested": p.netInvested,
    "Unrealized P&L": p.unrealizedProfit,
    "Total Value": p.totalValue,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.04 250)" vertical={false} />
        <XAxis
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tickMargin={10}
          fontSize={12}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tickMargin={10}
          fontSize={11}
          width={80}
          tickFormatter={(v) => `RM ${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
        />
        <ReferenceLine y={0} stroke="oklch(0.4 0.04 250)" />
        <Tooltip
          formatter={(value: any, name: any) => [
            `RM ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
            name,
          ]}
          contentStyle={{
            background: "oklch(0.15 0.02 250)",
            border: "1px solid oklch(0.25 0.04 250)",
            borderRadius: "8px",
            color: "oklch(0.98 0.01 250)",
            fontSize: "12px",
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
          formatter={(value) => (
            <span style={{ color: "oklch(0.7 0.05 250)" }}>{value}</span>
          )}
        />
        <Bar dataKey="Net Invested" fill={COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={40} />
        <Bar dataKey="Unrealized P&L" fill={COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={40} />
        <Bar dataKey="Total Value" fill={COLORS[3]} radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
}
