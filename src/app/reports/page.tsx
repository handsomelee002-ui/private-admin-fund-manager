import { sql } from "@vercel/postgres";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { calcDailyCompoundInterest } from "@/lib/savingsUtils";
import { getPlatforms, ensureRealizedProfitColumn } from "@/actions/trading";
import { PlatformComparisonChart } from "@/components/PlatformComparisonChart";
import { MonthlyPnLChart } from "@/components/MonthlyPnLChart";
import { TrendingUp, Users, DollarSign, BarChart3, Activity, Award } from "lucide-react";

export default async function ReportsPage() {
  // Ensure schema is up to date before querying realized_profit
  await ensureRealizedProfitColumn();

  // ── 1. Platform data (for comparison chart + realized profit) ─────────────
  const platforms = await getPlatforms();

  // ── 2. Realized Profit per platform ──────────────────────────────────────
  const realizedRes = await sql`
    SELECT 
      p.name,
      COALESCE(SUM(pt.realized_profit), 0) as total_realized
    FROM platforms p
    LEFT JOIN platform_transactions pt ON p.id = pt.platform_id
      AND pt.type = 'Withdraw'
      AND pt.realized_profit IS NOT NULL
    GROUP BY p.id, p.name
    ORDER BY total_realized DESC
  `;
  const totalRealizedProfit = realizedRes.rows.reduce(
    (sum: number, r: any) => sum + parseFloat(r.total_realized),
    0,
  );

  // ── 3. Monthly P&L data ───────────────────────────────────────────────────
  // Unrealized per month (latest snapshot per platform)
  const allPerfRes = await sql`
    SELECT platform_id, month, unrealized_profit
    FROM platform_performance
    ORDER BY month ASC
  `;
  // Realized per month (from platform transaction withdrawals with realized_profit)
  const monthlyRealizedRes = await sql`
    SELECT 
      TO_CHAR(date, 'YYYY-MM') as month,
      COALESCE(SUM(realized_profit), 0) as realized
    FROM platform_transactions
    WHERE type = 'Withdraw' AND realized_profit IS NOT NULL AND realized_profit > 0
    GROUP BY TO_CHAR(date, 'YYYY-MM')
    ORDER BY month ASC
  `;
  // Fixed savings interest accrued per deposit month (approximate: use start month)
  const fsDepositRows = await sql`
    SELECT amount, interest_rate, TO_CHAR(date, 'YYYY-MM-DD') as date, TO_CHAR(date, 'YYYY-MM') as month
    FROM fixed_savings_ledger
    WHERE type = 'Deposit' AND interest_rate IS NOT NULL AND interest_rate > 0
  `;

  // Build set of months across all data
  const monthsSet = new Set<string>();
  allPerfRes.rows.forEach((r: any) => monthsSet.add(r.month));
  monthlyRealizedRes.rows.forEach((r: any) => monthsSet.add(r.month));
  const currentMonth = new Date().toISOString().substring(0, 7);
  monthsSet.add(currentMonth);
  const allMonths = Array.from(monthsSet).sort();

  // Build monthly chart data
  const latestPerf = new Map<string, number>();
  const monthlyPnL = allMonths.map((month) => {
    // Update latest perf snapshot for this month
    allPerfRes.rows
      .filter((r: any) => r.month === month)
      .forEach((r: any) => latestPerf.set(r.platform_id, parseFloat(r.unrealized_profit)));

    const unrealized = Array.from(latestPerf.values()).reduce((s, v) => s + v, 0);
    const realized = parseFloat(
      monthlyRealizedRes.rows.find((r: any) => r.month === month)?.realized || 0,
    );

    return { month, unrealized, realized, total: unrealized + realized };
  });

  // ── 4. Total fund equity (for investor share calculations) ────────────────
  const totalEquityRes = await sql`
    SELECT COALESCE(SUM(CASE WHEN type='Deposit' THEN amount ELSE -amount END), 0) as total
    FROM capital_ledger
  `;
  const totalFundEquity = parseFloat(totalEquityRes.rows[0]?.total || 0);

  // Total unrealized (latest)
  const latestUnrealizedRes = await sql`
    SELECT SUM(unrealized_profit) as total
    FROM (
      SELECT unrealized_profit,
             ROW_NUMBER() OVER(PARTITION BY platform_id ORDER BY month DESC) as rn
      FROM platform_performance
    ) sub WHERE rn = 1
  `;
  const totalUnrealized = parseFloat(latestUnrealizedRes.rows[0]?.total || 0);

  // ── 5. Per-investor data: ROI, equity %, profit share ────────────────────
  const investorsRes = await sql`
    SELECT 
      i.id,
      i.name,
      COALESCE(SUM(CASE WHEN cl.type = 'Deposit' THEN cl.amount ELSE 0 END), 0) as total_deposits,
      COALESCE(SUM(CASE WHEN cl.type = 'Withdrawal' THEN cl.amount ELSE 0 END), 0) as total_withdrawals
    FROM investors i
    LEFT JOIN capital_ledger cl ON i.id = cl.investor_id
    GROUP BY i.id, i.name
    ORDER BY total_deposits DESC
  `;

  // Fixed savings per investor
  const fsSummaryRes = await sql`
    SELECT
      investor_id,
      COALESCE(SUM(CASE WHEN type = 'Deposit' THEN amount ELSE 0 END), 0) as fs_deposits,
      COALESCE(SUM(CASE WHEN type = 'Withdrawal' THEN amount ELSE 0 END), 0) as fs_withdrawals
    FROM fixed_savings_ledger
    GROUP BY investor_id
  `;
  const fsMap = new Map(
    fsSummaryRes.rows.map((r: any) => [
      r.investor_id,
      { deposits: parseFloat(r.fs_deposits), withdrawals: parseFloat(r.fs_withdrawals) },
    ]),
  );

  // Fixed savings accrued interest per investor
  const fsInterestRes = await sql`
    SELECT investor_id, amount, interest_rate, TO_CHAR(date, 'YYYY-MM-DD') as date
    FROM fixed_savings_ledger
    WHERE type = 'Deposit' AND interest_rate IS NOT NULL AND interest_rate > 0
  `;
  const investorAccruedMap = new Map<string, number>();
  for (const r of fsInterestRes.rows) {
    const accrued = calcDailyCompoundInterest(
      parseFloat(r.amount),
      parseFloat(r.interest_rate),
      r.date,
    );
    investorAccruedMap.set(r.investor_id, (investorAccruedMap.get(r.investor_id) || 0) + accrued);
  }

  const investorStats = investorsRes.rows.map((inv: any) => {
    const equityDeposits = parseFloat(inv.total_deposits);
    const equityWithdrawals = parseFloat(inv.total_withdrawals);
    const netEquity = equityDeposits - equityWithdrawals;

    const fs = fsMap.get(inv.id) || { deposits: 0, withdrawals: 0 };
    const netSavings = fs.deposits - fs.withdrawals;
    const accruedInterest = investorAccruedMap.get(inv.id) || 0;

    const equityPct = totalFundEquity > 0 ? (netEquity / totalFundEquity) * 100 : 0;
    const equityProfitShare = totalFundEquity > 0 ? (netEquity / totalFundEquity) * totalUnrealized : 0;

    const totalDeposited = equityDeposits + fs.deposits;
    const totalProfit = equityProfitShare + accruedInterest;
    const roi = totalDeposited > 0 ? (totalProfit / totalDeposited) * 100 : 0;
    const netValue = netEquity + netSavings + totalProfit;

    return {
      id: inv.id,
      name: inv.name,
      netEquity,
      netSavings,
      accruedInterest,
      equityPct,
      equityProfitShare,
      totalDeposited,
      totalProfit,
      roi,
      netValue,
    };
  });

  const fmt = (n: number) =>
    `RM ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
          Reports
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Fund analytics, investor statements, and performance breakdown.
        </p>
      </div>

      {/* ── Summary Row ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Unrealized P&L</CardTitle>
            <TrendingUp className="h-3.5 w-3.5 text-blue-400" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className={`text-xl font-bold ${totalUnrealized >= 0 ? "text-blue-400" : "text-red-400"}`}>
              {fmt(totalUnrealized)}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Realized Profit</CardTitle>
            <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold text-emerald-400">{fmt(totalRealizedProfit)}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total P&L</CardTitle>
            <Activity className="h-3.5 w-3.5 text-primary" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold">{fmt(totalUnrealized + totalRealizedProfit)}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Investors</CardTitle>
            <Users className="h-3.5 w-3.5 text-violet-400" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold">{investorStats.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* ── Charts Row ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {/* Monthly P&L Chart */}
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="pb-0">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Monthly P&amp;L</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">Unrealized + Realized profit by month</p>
          </CardHeader>
          <CardContent className="h-[300px] pt-4">
            <MonthlyPnLChart data={monthlyPnL} />
          </CardContent>
        </Card>

        {/* Platform Comparison */}
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="pb-0">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Platform Comparison</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">Net invested vs unrealized vs total value</p>
          </CardHeader>
          <CardContent className="h-[300px] pt-4">
            <PlatformComparisonChart platforms={platforms} />
          </CardContent>
        </Card>
      </div>

      {/* ── Realized Profit per Platform ─────────────────────────────────────── */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-400" />
            <CardTitle className="text-base">Realized Profit by Platform</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {realizedRes.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No realized profit recorded yet. Record a withdrawal with a realized profit amount to track it.
            </p>
          ) : (
            realizedRes.rows.map((r: any) => {
              const val = parseFloat(r.total_realized);
              const pct = totalRealizedProfit > 0 ? (val / totalRealizedProfit) * 100 : 0;
              return (
                <div key={r.name} className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">{r.name}</span>
                    <span className="text-sm font-bold text-emerald-400">{fmt(val)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${pct.toFixed(1)}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* ── Investor Statements ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Award className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold">Investor Statements</h2>
        </div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
          {investorStats.map((inv, idx) => {
            const rankColors = ["text-amber-400", "text-slate-400", "text-orange-600"];
            return (
              <Card
                key={inv.id}
                className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm hover:shadow-md transition-all duration-200"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
                        {inv.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold">{inv.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge
                            variant="outline"
                            className="text-[10px] h-4 px-1.5 text-violet-400 border-violet-400/30 bg-violet-400/5"
                          >
                            {inv.equityPct.toFixed(1)}% equity
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-[10px] h-4 px-1.5 border-emerald-500/30 bg-emerald-500/5 ${
                              inv.roi >= 0 ? "text-emerald-500" : "text-red-400"
                            }`}
                          >
                            ROI {inv.roi >= 0 ? "+" : ""}{inv.roi.toFixed(2)}%
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Net Value</p>
                      <p className="text-lg font-bold text-primary">{fmt(inv.netValue)}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t border-border/40 pt-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Equity Capital</p>
                      <p className="font-semibold">{fmt(inv.netEquity)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Fixed Savings</p>
                      <p className="font-semibold">{fmt(inv.netSavings)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Accrued Interest</p>
                      <p className="font-semibold text-orange-400">+{fmt(inv.accruedInterest)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Equity Profit Share</p>
                      <p className={`font-semibold ${inv.equityProfitShare >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {inv.equityProfitShare >= 0 ? "+" : ""}{fmt(inv.equityProfitShare)}
                      </p>
                    </div>
                  </div>

                  {/* Profit Distribution Progress */}
                  <div className="mt-4 space-y-1.5">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Equity Ownership Share</span>
                      <span>{inv.equityPct.toFixed(2)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-primary transition-all duration-500"
                        style={{ width: `${Math.min(100, inv.equityPct).toFixed(2)}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Total Profit Share</span>
                      <span>{fmt(inv.totalProfit)}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          inv.roi >= 0 ? "bg-emerald-500" : "bg-red-500"
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(0, (inv.totalProfit / Math.max(inv.totalDeposited, 1)) * 100),
                          ).toFixed(2)}%`,
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {investorStats.length === 0 && (
            <div className="col-span-2 text-center text-muted-foreground py-12 text-sm">
              No investors found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
