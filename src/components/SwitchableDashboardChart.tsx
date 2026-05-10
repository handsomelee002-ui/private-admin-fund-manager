"use client";

import { useState, useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function SwitchableDashboardChart({ data }: { data: any[] }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [period, setPeriod] = useState("YTD");

  const years = useMemo(() => {
    const y = new Set<string>();
    data.forEach(d => y.add(d.month.split('-')[0]));
    return Array.from(y).sort((a, b) => b.localeCompare(a));
  }, [data]);

  const filteredData = useMemo(() => {
    if (period === "ALL") return data;
    
    if (period === "YTD") {
      const currentYear = new Date().getFullYear().toString();
      return data.filter(d => d.month.startsWith(currentYear));
    }
    
    return data.filter(d => d.month.startsWith(period));
  }, [data, period]);

  return (
    <div className="h-full w-full flex flex-col p-4 pt-0">
      <div className="flex justify-between items-center mb-4 pt-4">
        <Select value={period} onValueChange={(val) => { if (val) setPeriod(val); }}>
          <SelectTrigger className="w-[180px] bg-card/50">
            <SelectValue placeholder="Select Period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="YTD">Year to Date</SelectItem>
            <SelectItem value="ALL">All Time</SelectItem>
            {years.map(y => (
              <SelectItem key={y} value={y}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-[300px] grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="unrealized">Unrealized</TabsTrigger>
            <TabsTrigger value="realized">Withdrawals</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 min-h-[250px]">
        {activeTab === "overview" && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={filteredData}>
              <defs>
                <linearGradient id="colorOverview" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" axisLine={false} tickLine={false} tickMargin={10} fontSize={12} />
              <YAxis axisLine={false} tickLine={false} tickMargin={10} fontSize={12} width={80} tickFormatter={(v) => `RM ${v}`} />
              <Tooltip formatter={(value: any) => [`RM ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Total Value"]} labelStyle={{ color: '#000' }} />
              <Area type="monotone" dataKey="totalValue" stroke="#3b82f6" fillOpacity={1} fill="url(#colorOverview)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {activeTab === "unrealized" && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={filteredData}>
              <defs>
                <linearGradient id="colorUnrealized" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" axisLine={false} tickLine={false} tickMargin={10} fontSize={12} />
              <YAxis axisLine={false} tickLine={false} tickMargin={10} fontSize={12} width={80} tickFormatter={(v) => `RM ${v}`} />
              <Tooltip formatter={(value: any) => [`RM ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Unrealized"]} labelStyle={{ color: '#000' }} />
              <Area type="monotone" dataKey="unrealized" stroke="#10b981" fillOpacity={1} fill="url(#colorUnrealized)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {activeTab === "realized" && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filteredData}>
              <XAxis dataKey="month" axisLine={false} tickLine={false} tickMargin={10} fontSize={12} />
              <YAxis axisLine={false} tickLine={false} tickMargin={10} fontSize={12} width={80} tickFormatter={(v) => `RM ${v}`} />
              <Tooltip formatter={(value: any) => [`RM ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Withdrawals"]} cursor={{fill: 'transparent'}} labelStyle={{ color: '#000' }} />
              <Bar dataKey="withdrawals" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={50} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
