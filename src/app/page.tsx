import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, TrendingUp, Users, DollarSign } from "lucide-react";
import { sql } from "@vercel/postgres";
import { SwitchableDashboardChart } from "@/components/SwitchableDashboardChart";
import { Badge } from "@/components/ui/badge";

export default async function Dashboard() {
  // 1. Investor Capital
  const capitalRes = await sql`
    SELECT 
      SUM(CASE WHEN type = 'Deposit' THEN amount ELSE 0 END) as total_deposits,
      SUM(CASE WHEN type = 'Withdrawal' THEN amount ELSE 0 END) as total_withdrawals
    FROM capital_ledger
  `;
  const totalInvestorCapital = parseFloat(capitalRes.rows[0]?.total_deposits || 0) - parseFloat(capitalRes.rows[0]?.total_withdrawals || 0);

  // 2. Trading Platforms Logic
  const platformTxRes = await sql`
    SELECT 
      SUM(CASE WHEN type = 'Deposit' THEN amount ELSE 0 END) as total_deposits,
      SUM(CASE WHEN type = 'Withdraw' THEN amount ELSE 0 END) as total_withdrawals
    FROM platform_transactions
  `;
  const totalPlatformDeposits = parseFloat(platformTxRes.rows[0]?.total_deposits || 0);
  const totalPlatformWithdrawals = parseFloat(platformTxRes.rows[0]?.total_withdrawals || 0);
  const netPlatformInvested = totalPlatformDeposits - totalPlatformWithdrawals;

  // 3. Unrealized Performance
  const perfData = await sql`
    SELECT SUM(unrealized_profit) as total_unrealized 
    FROM (
      SELECT unrealized_profit,
             ROW_NUMBER() OVER(PARTITION BY platform_id ORDER BY month DESC) as rn
      FROM platform_performance
    ) sub
    WHERE rn = 1;
  `;
  const totalUnrealized = parseFloat(perfData.rows[0]?.total_unrealized || 0);

  // Math
  const availableCash = totalInvestorCapital - netPlatformInvested;
  const totalPlatformValue = netPlatformInvested + totalUnrealized;
  const totalFundValue = availableCash + totalPlatformValue;

  // Recent 5 Transactions (Union of Capital and Platforms)
  const recentRes = await sql`
    SELECT id, date, 'Investor Capital' as category, type, amount as amount_rm, notes as details
    FROM capital_ledger
    UNION ALL
    SELECT pt.id, pt.date, 'Trading Platform' as category, pt.type, pt.amount as amount_rm, p.name as details
    FROM platform_transactions pt
    JOIN platforms p ON pt.platform_id = p.id
    ORDER BY date DESC
    LIMIT 5
  `;
  const recentTransactions = recentRes.rows;

  // Generate Chart Data in JS for accurate historical calculations
  const allCapitalRes = await sql`SELECT to_char(date, 'YYYY-MM') as month, type, amount FROM capital_ledger ORDER BY date ASC`;
  const allPerfRes = await sql`SELECT platform_id, month, unrealized_profit FROM platform_performance ORDER BY month ASC`;
  const allPlatformTxRes = await sql`SELECT to_char(date, 'YYYY-MM') as month, type, amount FROM platform_transactions ORDER BY date ASC`;

  // Get range of months
  const monthsSet = new Set<string>();
  allCapitalRes.rows.forEach(r => monthsSet.add(r.month));
  allPerfRes.rows.forEach(r => monthsSet.add(r.month));
  allPlatformTxRes.rows.forEach(r => monthsSet.add(r.month));
  
  const currentMonthStr = new Date().toISOString().substring(0, 7);
  monthsSet.add(currentMonthStr);
  const sortedMonths = Array.from(monthsSet).sort();
  
  const allMonths = [];
  if (sortedMonths.length > 0) {
    let curr = new Date(sortedMonths[0] + "-01");
    const end = new Date(sortedMonths[sortedMonths.length - 1] + "-01");
    while (curr <= end) {
      allMonths.push(curr.toISOString().substring(0, 7));
      curr.setMonth(curr.getMonth() + 1);
    }
  }

  const chartData = [];
  let cumulativeInvestorCapital = 0;
  const latestPlatformPerf = new Map<string, number>();

  for (const month of allMonths) {
    // 1. Add capital for this month
    const monthCapitals = allCapitalRes.rows.filter(r => r.month === month);
    for (const cap of monthCapitals) {
      if (cap.type === 'Deposit') cumulativeInvestorCapital += parseFloat(cap.amount);
      if (cap.type === 'Withdrawal') cumulativeInvestorCapital -= parseFloat(cap.amount);
    }

    // 2. Add performance for this month
    const monthPerfs = allPerfRes.rows.filter(r => r.month === month);
    for (const perf of monthPerfs) {
      latestPlatformPerf.set(perf.platform_id, parseFloat(perf.unrealized_profit));
    }

    // 3. Withdrawals for this month (for the bar chart)
    const monthTx = allPlatformTxRes.rows.filter(r => r.month === month);
    let withdrawals = 0;
    for (const tx of monthTx) {
      if (tx.type === 'Withdraw') withdrawals += parseFloat(tx.amount);
    }

    // Sum up latest performance of all platforms
    let totalUnrealizedThisMonth = 0;
    for (const val of latestPlatformPerf.values()) {
      totalUnrealizedThisMonth += val;
    }

    chartData.push({
      month,
      withdrawals,
      unrealized: totalUnrealizedThisMonth,
      totalValue: cumulativeInvestorCapital + totalUnrealizedThisMonth
    });
  }

  const stats = [
    {
      title: "Total Fund Value",
      value: `RM ${totalFundValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      icon: DollarSign,
      trend: "Current Total AUM",
    },
    {
      title: "Total Unrealized",
      value: `RM ${totalUnrealized.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      icon: TrendingUp,
      trend: "Current open profits",
    },
    {
      title: "Total Investor Capital",
      value: `RM ${totalInvestorCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      icon: Users,
      trend: "Net capital from investors",
    },
    {
      title: "Available Cash",
      value: `RM ${availableCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      icon: Wallet,
      trend: "Available for deposit",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Overview of your private fund performance and liquidity.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm transition-all hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stat.trend}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader>
            <CardTitle>Performance Metrics</CardTitle>
          </CardHeader>
          <CardContent className="pl-0 pb-0 h-[350px]">
            <SwitchableDashboardChart data={chartData} />
          </CardContent>
        </Card>
        
        <Card className="col-span-3 bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentTransactions.length === 0 ? (
              <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
                No recent activity.
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {recentTransactions.map((tx: any, idx: number) => (
                  <div key={`${tx.id}-${idx}`} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{tx.category}</span>
                        <Badge variant="outline" className={`text-[10px] h-4 px-1 ${
                          tx.type === 'Deposit' || tx.type === 'Withdrawal' ? 'text-blue-500' : 'text-orange-500'
                        }`}>{tx.type}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(tx.date).toLocaleDateString()} • {tx.details || "-"}</span>
                    </div>
                    <div className="font-bold text-primary">
                      RM {parseFloat(tx.amount_rm).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
