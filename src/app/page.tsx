import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Wallet,
  TrendingUp,
  Users,
  DollarSign,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
} from "lucide-react";
import { sql } from "@vercel/postgres";
import { SwitchableDashboardChart } from "@/components/SwitchableDashboardChart";
import { PlatformAllocationPieChart } from "@/components/PlatformAllocationPieChart";
import { Badge } from "@/components/ui/badge";
import { calcDailyCompoundInterest } from "@/lib/savingsUtils";

export default async function Dashboard() {
  // ── 1. Investor Capital (Equity) ──────────────────────────────────────────
  const capitalRes = await sql`
    SELECT 
      SUM(CASE WHEN type IN ('Deposit','Bonus') THEN amount ELSE 0 END) as total_deposits,
      SUM(CASE WHEN type = 'Withdrawal' THEN amount ELSE 0 END) as total_withdrawals
    FROM capital_ledger
  `;
  const totalEquityCapital =
    parseFloat(capitalRes.rows[0]?.total_deposits || 0) -
    parseFloat(capitalRes.rows[0]?.total_withdrawals || 0);

  // ── 1b. Fixed Savings Capital (Debt) — principal + dynamically accrued interest ──
  const fixedSavingsRes = await sql`
    SELECT 
      SUM(CASE WHEN type IN ('Deposit','Bonus') THEN amount ELSE 0 END) as total_deposits,
      SUM(CASE WHEN type = 'Withdrawal' THEN amount ELSE 0 END) as total_withdrawals
    FROM fixed_savings_ledger
  `;
  const fixedSavingsPrincipal =
    parseFloat(fixedSavingsRes.rows[0]?.total_deposits || 0) -
    parseFloat(fixedSavingsRes.rows[0]?.total_withdrawals || 0);

  // Fetch all deposit rows with an interest rate to compute accrued interest
  const fsDepositRows = await sql`
    SELECT amount, interest_rate, TO_CHAR(date, 'YYYY-MM-DD') as date
    FROM fixed_savings_ledger
    WHERE type = 'Deposit' AND interest_rate IS NOT NULL AND interest_rate > 0
  `;
  const totalFixedAccrued = fsDepositRows.rows.reduce((sum: number, r: any) => {
    return sum + calcDailyCompoundInterest(
      parseFloat(r.amount),
      parseFloat(r.interest_rate),
      r.date,
    );
  }, 0);

  const totalFixedSavingsCash = fixedSavingsPrincipal + totalFixedAccrued;
  const totalInvestorCapital = totalEquityCapital + totalFixedSavingsCash;

  // ── 2. Trading Platforms Logic ─────────────────────────────────────────────
  const platformTxRes = await sql`
    SELECT 
      SUM(CASE WHEN type = 'Deposit' THEN amount ELSE 0 END) as total_deposits,
      SUM(CASE WHEN type = 'Withdraw' THEN amount ELSE 0 END) as total_withdrawals
    FROM platform_transactions
  `;
  const totalPlatformDeposits = parseFloat(platformTxRes.rows[0]?.total_deposits || 0);
  const totalPlatformWithdrawals = parseFloat(platformTxRes.rows[0]?.total_withdrawals || 0);
  const netPlatformInvested = totalPlatformDeposits - totalPlatformWithdrawals;

  // ── 3. Unrealized Performance ──────────────────────────────────────────────
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

  // ── 4. Platform Breakdown for Pie Chart ───────────────────────────────────
  const platformBreakdownRes = await sql`
    SELECT 
      p.name,
      COALESCE(SUM(CASE WHEN pt.type = 'Deposit' THEN pt.amount ELSE -pt.amount END), 0) as net_invested
    FROM platforms p
    LEFT JOIN platform_transactions pt ON p.id = pt.platform_id
    GROUP BY p.id, p.name
    HAVING COALESCE(SUM(CASE WHEN pt.type = 'Deposit' THEN pt.amount ELSE -pt.amount END), 0) > 0
    ORDER BY net_invested DESC
  `;
  const platformPieData = platformBreakdownRes.rows.map((r: any) => ({
    name: r.name,
    value: parseFloat(r.net_invested),
  }));

  // ── 5. Derived Math ───────────────────────────────────────────────────────
  const totalPrincipalCapital = totalEquityCapital + fixedSavingsPrincipal;
  const availableCash = totalPrincipalCapital - netPlatformInvested;
  const totalPlatformValue = netPlatformInvested + totalUnrealized;
  const totalFundValue = availableCash + totalPlatformValue;
  const netFundProfit = totalUnrealized - totalFixedAccrued;

  // ── 6. Recent 5 Transactions ──────────────────────────────────────────────
  const recentRes = await sql`
    SELECT id, date, 'Investor Capital' as category, type, amount as amount_rm, notes as details
    FROM capital_ledger
    UNION ALL
    SELECT id, date, 'Fixed Savings' as category, type, amount as amount_rm, notes as details
    FROM fixed_savings_ledger
    UNION ALL
    SELECT pt.id, pt.date, 'Trading Platform' as category, pt.type, pt.amount as amount_rm, p.name as details
    FROM platform_transactions pt
    JOIN platforms p ON pt.platform_id = p.id
    ORDER BY date DESC
    LIMIT 5
  `;
  const recentTransactions = recentRes.rows;

  // ── 7. Chart Data ─────────────────────────────────────────────────────────
  const allCapitalRes = await sql`
    SELECT to_char(date, 'YYYY-MM') as month, type, amount 
    FROM capital_ledger 
    UNION ALL
    SELECT to_char(date, 'YYYY-MM') as month, type, amount 
    FROM fixed_savings_ledger 
    WHERE type != 'Interest'
  `;
  const allPerfRes = await sql`SELECT platform_id, month, unrealized_profit FROM platform_performance ORDER BY month ASC`;
  const allPlatformTxRes = await sql`SELECT to_char(date, 'YYYY-MM') as month, type, amount FROM platform_transactions ORDER BY date ASC`;

  const monthsSet = new Set<string>();
  allCapitalRes.rows.forEach(r => monthsSet.add(r.month));
  allPerfRes.rows.forEach(r => monthsSet.add(r.month));
  allPlatformTxRes.rows.forEach(r => monthsSet.add(r.month));

  const currentMonthStr = new Date().toISOString().substring(0, 7);
  monthsSet.add(currentMonthStr);
  const sortedMonths = Array.from(monthsSet).sort();

  const allMonths: string[] = [];
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
    const monthCapitals = allCapitalRes.rows.filter(r => r.month === month);
    for (const cap of monthCapitals) {
      if (cap.type === "Deposit") cumulativeInvestorCapital += parseFloat(cap.amount);
      if (cap.type === "Withdrawal") cumulativeInvestorCapital -= parseFloat(cap.amount);
    }

    const monthPerfs = allPerfRes.rows.filter(r => r.month === month);
    for (const perf of monthPerfs) {
      latestPlatformPerf.set(perf.platform_id, parseFloat(perf.unrealized_profit));
    }

    const monthTx = allPlatformTxRes.rows.filter(r => r.month === month);
    let withdrawals = 0;
    for (const tx of monthTx) {
      if (tx.type === "Withdraw") withdrawals += parseFloat(tx.amount);
    }

    let totalUnrealizedThisMonth = 0;
    for (const val of latestPlatformPerf.values()) {
      totalUnrealizedThisMonth += val;
    }

    chartData.push({
      month,
      withdrawals,
      unrealized: totalUnrealizedThisMonth,
      totalValue: cumulativeInvestorCapital + totalUnrealizedThisMonth,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const fmt = (n: number) =>
    `RM ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  const profitPct =
    totalInvestorCapital > 0
      ? ((netFundProfit / totalInvestorCapital) * 100).toFixed(2)
      : "0.00";

  return (
    <div className="space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Dashboard
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Private fund performance &amp; liquidity overview
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Last updated</p>
          <p className="text-sm font-medium">
            {new Date().toLocaleDateString("en-MY", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      {/* ── Primary Stat Row (3 cols) ────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        {/* Total Fund Value */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 shadow-lg hover:shadow-primary/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Fund Value
            </CardTitle>
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{fmt(totalFundValue)}</div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Cash + Platform Assets
            </p>
          </CardContent>
        </Card>

        {/* Net Fund Profit */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-500/25 shadow-lg hover:shadow-emerald-500/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Net Fund Profit
            </CardTitle>
            <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold tracking-tight ${netFundProfit >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {fmt(netFundProfit)}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <span className={`font-semibold ${netFundProfit >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                {netFundProfit >= 0 ? "+" : ""}{profitPct}%
              </span>
              &nbsp;vs investor capital
            </p>
          </CardContent>
        </Card>

        {/* Total Investor Capital */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-violet-500/15 to-violet-500/5 border-violet-500/25 shadow-lg hover:shadow-violet-500/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Investor Capital
            </CardTitle>
            <div className="h-8 w-8 rounded-full bg-violet-500/15 flex items-center justify-center">
              <Users className="h-4 w-4 text-violet-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{fmt(totalInvestorCapital)}</div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Principal + Accrued Interest
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Secondary Stat Row (4 cols) ──────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/30 transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Available Cash</CardTitle>
            <Wallet className="h-3.5 w-3.5 text-primary" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold">{fmt(availableCash)}</div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Liquidity for new trades</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/30 transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Unrealized Profit</CardTitle>
            <BarChart3 className="h-3.5 w-3.5 text-blue-400" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className={`text-xl font-bold ${totalUnrealized >= 0 ? "text-blue-400" : "text-red-400"}`}>
              {fmt(totalUnrealized)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Current platform profits</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/30 transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Net Deployed</CardTitle>
            <ArrowUpRight className="h-3.5 w-3.5 text-amber-400" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold text-amber-400">{fmt(netPlatformInvested)}</div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Across all platforms</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/30 transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Interest Owed</CardTitle>
            <ArrowDownRight className="h-3.5 w-3.5 text-orange-400" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold text-orange-400">{fmt(totalFixedAccrued)}</div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Fixed savings accrued</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Main Content Row ─────────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-7">
        {/* Performance Chart (col-span-4) */}
        <Card className="lg:col-span-4 bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="pb-0">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Performance Metrics</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pl-0 pb-0 h-[340px]">
            <SwitchableDashboardChart data={chartData} />
          </CardContent>
        </Card>

        {/* Platform Allocation Pie (col-span-3) */}
        <Card className="lg:col-span-3 bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="pb-0">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Platform Allocation</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">By net capital deployed</p>
          </CardHeader>
          <CardContent className="h-[310px] pt-2">
            <PlatformAllocationPieChart data={platformPieData} />
          </CardContent>
        </Card>
      </div>

      {/* ── Bottom Row: Capital Breakdown + Recent Activity ────────────── */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-7">
        {/* Capital Breakdown (col-span-3) */}
        <Card className="lg:col-span-3 bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Capital Breakdown</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              {
                label: "Equity Capital",
                value: totalEquityCapital,
                pct: totalInvestorCapital > 0 ? (totalEquityCapital / totalInvestorCapital) * 100 : 0,
                color: "bg-indigo-500",
                textColor: "text-indigo-400",
              },
              {
                label: "Fixed Savings (Principal)",
                value: fixedSavingsPrincipal,
                pct: totalInvestorCapital > 0 ? (fixedSavingsPrincipal / totalInvestorCapital) * 100 : 0,
                color: "bg-amber-500",
                textColor: "text-amber-400",
              },
              {
                label: "Accrued Interest",
                value: totalFixedAccrued,
                pct: totalInvestorCapital > 0 ? (totalFixedAccrued / totalInvestorCapital) * 100 : 0,
                color: "bg-orange-500",
                textColor: "text-orange-400",
              },
              {
                label: "Platform Value",
                value: totalPlatformValue,
                pct: totalFundValue > 0 ? (totalPlatformValue / totalFundValue) * 100 : 0,
                color: "bg-emerald-500",
                textColor: "text-emerald-400",
              },
              {
                label: "Available Cash",
                value: availableCash,
                pct: totalFundValue > 0 ? (availableCash / totalFundValue) * 100 : 0,
                color: "bg-blue-500",
                textColor: "text-blue-400",
              },
            ].map((item) => (
              <div key={item.label} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <span className={`text-xs font-semibold ${item.textColor}`}>
                    {fmt(item.value)}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.color} transition-all duration-500`}
                    style={{ width: `${Math.max(0, Math.min(100, item.pct)).toFixed(1)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent Activity (col-span-4) */}
        <Card className="lg:col-span-4 bg-card/50 backdrop-blur-sm border-border/50 shadow-sm overflow-hidden">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Recent Activity</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {recentTransactions.length === 0 ? (
              <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
                No recent activity.
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {recentTransactions.map((tx: any, idx: number) => (
                  <div
                    key={`${tx.id}-${idx}`}
                    className="px-6 py-3.5 flex items-center justify-between hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          tx.type === "Deposit"
                            ? "bg-emerald-500/15"
                            : tx.type === "Withdrawal"
                            ? "bg-red-500/15"
                            : "bg-amber-500/15"
                        }`}
                      >
                        {tx.type === "Deposit" ? (
                          <ArrowDownRight
                            className={`h-4 w-4 ${
                              tx.category === "Trading Platform"
                                ? "text-amber-400"
                                : "text-emerald-400"
                            }`}
                          />
                        ) : (
                          <ArrowUpRight className="h-4 w-4 text-red-400" />
                        )}
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium leading-tight">
                            {tx.details || tx.category}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[9px] h-4 px-1.5 leading-none ${
                              tx.type === "Deposit"
                                ? "text-emerald-500 border-emerald-500/30"
                                : "text-red-500 border-red-500/30"
                            }`}
                          >
                            {tx.type}
                          </Badge>
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(tx.date).toLocaleDateString("en-MY", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                          {" · "}
                          {tx.category}
                        </span>
                      </div>
                    </div>
                    <div
                      className={`text-sm font-bold tabular-nums ${
                        tx.type === "Deposit" ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {tx.type === "Withdrawal" ? "-" : "+"}RM{" "}
                      {parseFloat(tx.amount_rm).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
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
