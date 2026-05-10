"use client";

import { Bar, BarChart, Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";

export function PlatformTransactionsChart({ data }: { data: any[] }) {
  // Aggregate data by month for cleaner chart
  const aggregated = data.reduce((acc: any, curr: any) => {
    const month = curr.date.substring(0, 7); // YYYY-MM
    if (!acc[month]) acc[month] = { month, deposit: 0, withdrawal: 0, net: 0 };
    
    const amount = parseFloat(curr.amount);
    if (curr.type === 'Deposit') {
      acc[month].deposit += amount;
      acc[month].net += amount;
    } else {
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
    <div className="h-[250px] w-full pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
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
      </ResponsiveContainer>
    </div>
  );
}

export function PlatformPerformanceChart({ data }: { data: any[] }) {
  const chartData = [...data].sort((a: any, b: any) => a.month.localeCompare(b.month)).map(p => ({
    month: p.month,
    profit: parseFloat(p.unrealized_profit)
  }));

  if (chartData.length === 0) {
    return <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">Not enough data to display chart</div>;
  }

  return (
    <div className="h-[250px] w-full pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="month" axisLine={false} tickLine={false} tickMargin={10} fontSize={12} />
          <YAxis axisLine={false} tickLine={false} tickMargin={10} fontSize={12} width={80} tickFormatter={(v) => `RM ${v}`} />
          <Tooltip 
            formatter={(value: any) => [`RM ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Unrealized"]} 
            labelStyle={{ color: '#000' }} 
          />
          <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
          <Area type="monotone" dataKey="profit" stroke="#3b82f6" fillOpacity={1} fill="url(#colorProfit)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
