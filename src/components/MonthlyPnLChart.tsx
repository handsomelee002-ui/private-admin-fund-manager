"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

interface MonthlyPnLData {
  month: string;
  unrealized: number;
  realized: number;
  total: number;
}

export function MonthlyPnLChart({ data }: { data: MonthlyPnLData[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        No P&amp;L data available.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.04 250)" vertical={false} />
        <XAxis
          dataKey="month"
          axisLine={false}
          tickLine={false}
          tickMargin={10}
          fontSize={11}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tickMargin={10}
          fontSize={11}
          width={80}
          tickFormatter={(v) =>
            `RM ${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`
          }
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
        <Bar dataKey="unrealized" name="Unrealized" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} opacity={0.8} />
        <Bar dataKey="realized" name="Realized" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} opacity={0.8} />
        <Line
          type="monotone"
          dataKey="total"
          name="Total P&L"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={{ fill: "#f59e0b", r: 3 }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
