"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface PlatformSlice {
  name: string;
  value: number;
}

/**
 * How the tooltip reads the slice value. The investor portal passes percentages
 * and must never be handed RM figures - hiding them in the tooltip would not
 * help, since the numbers still ship to the browser in the page payload.
 */
export type AllocationValueMode = "money" | "percent";

const COLORS = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#f97316", // orange
];

const RADIAN = Math.PI / 180;

function CustomLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: any) {
  if (percent < 0.05) return null; // skip tiny slices
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  );
}

export function PlatformAllocationPieChart({
  data,
  valueMode = "money",
  valueLabel,
}: {
  data: PlatformSlice[];
  valueMode?: AllocationValueMode;
  valueLabel?: string;
}) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        No platform allocation data available.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={CustomLabel}
          outerRadius="75%"
          innerRadius="40%"
          dataKey="value"
          strokeWidth={2}
          stroke="oklch(0.12 0.02 250)"
        >
          {data.map((_, index) => (
            <Cell
              key={`cell-${index}`}
              fill={COLORS[index % COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: any) => [
            valueMode === "percent"
              ? `${Number(value).toFixed(2)}%`
              : `RM ${Number(value).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`,
            valueLabel ?? (valueMode === "percent" ? "Allocation" : "Net Invested"),
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
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
          formatter={(value) => (
            <span style={{ color: "oklch(0.7 0.05 250)" }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
