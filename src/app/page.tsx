import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, TrendingUp, Users, DollarSign } from "lucide-react";
import { sql } from "@vercel/postgres";
import { DashboardChart } from "@/components/DashboardChart";
import { Badge } from "@/components/ui/badge";

export default async function Dashboard() {
  // Fetch real data for stats
  const capitalRes = await sql`
    SELECT 
      SUM(CASE WHEN type = 'Deposit' THEN amount ELSE 0 END) as total_deposits,
      SUM(CASE WHEN type = 'Withdrawal' THEN amount ELSE 0 END) as total_withdrawals
    FROM capital_ledger
  `;
  const totalDeposits = parseFloat(capitalRes.rows[0]?.total_deposits || 0);
  const totalWithdrawals = parseFloat(capitalRes.rows[0]?.total_withdrawals || 0);
  const totalInvestorCapital = totalDeposits - totalWithdrawals;

  const tradeRes = await sql`
    SELECT 
      SUM(CASE WHEN type = 'Buy' THEN amount_rm ELSE 0 END) as total_buys,
      SUM(CASE WHEN type = 'Sell' THEN amount_rm ELSE 0 END) as total_sells,
      SUM(profit_loss) as total_profit
    FROM trading_ledger
  `;
  const totalBuys = parseFloat(tradeRes.rows[0]?.total_buys || 0);
  const totalSells = parseFloat(tradeRes.rows[0]?.total_sells || 0);
  const totalRealizedProfit = parseFloat(tradeRes.rows[0]?.total_profit || 0);

  const dryPowder = totalInvestorCapital + totalSells - totalBuys;
  const totalFundValue = totalInvestorCapital + totalRealizedProfit;

  // Recent 5 Transactions (Union of Capital and Trading)
  const recentRes = await sql`
    SELECT id, date, 'Capital' as category, type, amount as amount_rm, notes as details
    FROM capital_ledger
    UNION ALL
    SELECT id, date, 'Trade' as category, type, amount_rm, ticker as details
    FROM trading_ledger
    ORDER BY date DESC
    LIMIT 5
  `;
  const recentTransactions = recentRes.rows;

  const stats = [
    {
      title: "Total Fund Value",
      value: `RM ${totalFundValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      icon: DollarSign,
      trend: "Current AUM",
    },
    {
      title: "Realized Profit YTD",
      value: `RM ${totalRealizedProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      icon: TrendingUp,
      trend: "Total historical profit",
    },
    {
      title: "Total Investor Capital",
      value: `RM ${totalInvestorCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      icon: Users,
      trend: "Net active capital",
    },
    {
      title: "Available Cash",
      value: `RM ${dryPowder.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      icon: Wallet,
      trend: "Available for new trades",
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
            <CardTitle>Performance Overview</CardTitle>
          </CardHeader>
          <CardContent className="pl-0 pb-0 h-[300px]">
            <DashboardChart />
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
                {recentTransactions.map((tx: any) => (
                  <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{tx.category}</span>
                        <Badge variant="outline" className="text-[10px] h-4 px-1">{tx.type}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(tx.date).toLocaleDateString()} • {tx.details}</span>
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
