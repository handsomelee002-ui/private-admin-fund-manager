"use client";

import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, Area, AreaChart, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";

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
    <div ref={ref} className="h-[250px] min-h-[250px] w-full min-w-0 pt-4">
      {size.width > 0 && size.height > 0 ? children(size) : null}
    </div>
  );
}

export function PlatformTransactionsChart({ data }: { data: any[] }) {
  // Aggregate data by month for cleaner chart
  const aggregated = data.reduce((acc: any, curr: any) => {
    const month = curr.date.substring(0, 7); // YYYY-MM
    if (!acc[month]) acc[month] = { month, deposit: 0, withdrawal: 0, net: 0 };
    
    const amount = parseFloat(curr.base_amount || curr.amount || "0");
    if (["BROKER_DEPOSIT", "Deposit"].includes(curr.type)) {
      acc[month].deposit += amount;
      acc[month].net += amount;
    } else if (["BROKER_WITHDRAWAL", "Withdraw"].includes(curr.type)) {
      acc[month].withdrawal += amount;
      acc[month].net -= amount;
    }
    return acc;
  }, {});

  const chartData = Object.values(aggregated).sort((a: any, b: any) => a.month.localeCompare(b.month));

  if (chartData.length === 0) {
    return <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">Not enough data to display chart</div>;
  }

  return (
    <ChartFrame>
      {({ width, height }) => (
        <BarChart data={chartData} width={width} height={height}>
          <XAxis dataKey="month" axisLine={false} tickLine={false} tickMargin={10} fontSize={12} />
          <YAxis axisLine={false} tickLine={false} tickMargin={10} fontSize={12} width={80} tickFormatter={(v) => `RM ${v}`} />
          <Tooltip 
            formatter={(value: any, name: any) => [
              `RM ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 
              String(name).charAt(0).toUpperCase() + String(name).slice(1)
            ]} 
            cursor={{fill: 'transparent'}} 
            labelStyle={{ color: '#000' }} 
          />
          <Bar dataKey="deposit" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} stackId="a" />
          <Bar dataKey="withdrawal" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} stackId="b" />
        </BarChart>
      )}
    </ChartFrame>
  );
}

export function PlatformNavSnapshotChart({ data }: { data: any[] }) {
  const chartData = [...data].sort((a: any, b: any) => String(a.week_ending).localeCompare(String(b.week_ending))).map(p => ({
    week: p.week_ending,
    profit: parseFloat(p.unrealized_profit)
  }));

  if (chartData.length === 0) {
    return <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">Not enough data to display chart</div>;
  }

  return (
    <ChartFrame>
      {({ width, height }) => (
        <AreaChart data={chartData} width={width} height={height}>
          <defs>
            <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="week" axisLine={false} tickLine={false} tickMargin={10} fontSize={12} />
          <YAxis axisLine={false} tickLine={false} tickMargin={10} fontSize={12} width={80} tickFormatter={(v) => `RM ${v}`} />
          <Tooltip 
            formatter={(value: any) => [`RM ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Unrealized"]} 
            labelStyle={{ color: '#000' }} 
          />
          <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
          <Area type="monotone" dataKey="profit" stroke="#3b82f6" fillOpacity={1} fill="url(#colorProfit)" strokeWidth={2} />
        </AreaChart>
      )}
    </ChartFrame>
  );
}
