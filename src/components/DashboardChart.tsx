"use client";

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

const data = [
  { month: "Jan", value: 1000000 },
  { month: "Feb", value: 1105000 },
  { month: "Mar", value: 1150000 },
  { month: "Apr", value: 1210000 },
  { month: "May", value: 1250000 },
];

export function DashboardChart() {
  return (
    <div className="w-full h-full min-h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="oklch(0.45 0.15 250)" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="oklch(0.45 0.15 250)" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="opacity-10" />
          <XAxis 
            dataKey="month" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 12 }} 
            dy={10}
            stroke="currentColor" 
            className="opacity-50"
          />
          <YAxis 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 12 }} 
            tickFormatter={(val) => `RM ${(val/1000).toFixed(0)}k`}
            dx={-10}
            stroke="currentColor" 
            className="opacity-50"
          />
          <Tooltip 
            contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
            formatter={(value: any) => [`RM ${Number(value).toLocaleString()}`, "Fund Value"]}
          />
          <Area 
            type="monotone" 
            dataKey="value" 
            stroke="oklch(0.45 0.15 250)" 
            strokeWidth={3}
            fillOpacity={1} 
            fill="url(#colorValue)" 
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
