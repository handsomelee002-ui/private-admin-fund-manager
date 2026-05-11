import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, TrendingUp, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { sql } from "@vercel/postgres";
import { getCapitalLedgerByInvestor } from "@/actions/capital";
import { getFixedSavingsByInvestor } from "@/actions/fixedSavings";
import { calcDailyCompoundInterest } from "@/lib/savingsUtils";
import { getPlatforms } from "@/actions/trading";

export default async function InvestorPortalPage({ params }: { params: Promise<{ investor_id: string }> }) {
  const { investor_id } = await params;

  // 1. Fetch Investor Details
  const invRes = await sql`SELECT * FROM investors WHERE id = ${investor_id}`;
  const investor = invRes.rows[0];
  if (!investor) {
    return <div className="p-8 text-center">Investor not found.</div>;
  }

  // 2. Fetch Personal Capital (Equity)
  const equityRecords = await getCapitalLedgerByInvestor(investor_id);
  const myEquityDeposits = equityRecords.filter(r => r.type === 'Deposit').reduce((sum, r) => sum + parseFloat(r.amount), 0);
  const myEquityWithdrawals = equityRecords.filter(r => r.type === 'Withdrawal').reduce((sum, r) => sum + parseFloat(r.amount), 0);
  const myNetEquity = myEquityDeposits - myEquityWithdrawals;

  // 3. Fetch Personal Fixed Savings
  const savingsRecords = await getFixedSavingsByInvestor(investor_id);
  const mySavingsDeposits = savingsRecords.filter(r => r.type === 'Deposit').reduce((sum, r) => sum + parseFloat(r.amount), 0);
  const mySavingsWithdrawals = savingsRecords.filter(r => r.type === 'Withdrawal').reduce((sum, r) => sum + parseFloat(r.amount), 0);
  const myNetSavings = mySavingsDeposits - mySavingsWithdrawals;
  
  const myAccruedInterest = savingsRecords
    .filter(r => r.type === 'Deposit' && r.interest_rate != null && parseFloat(r.interest_rate) > 0)
    .reduce((sum, r) => {
      return sum + calcDailyCompoundInterest(parseFloat(r.amount), parseFloat(r.interest_rate), r.date);
    }, 0);

  // 4. Calculate Share of Fund Profit (for Equity)
  // Get Total Fund Equity
  const totalEquityRes = await sql`
    SELECT 
      SUM(CASE WHEN type = 'Deposit' THEN amount ELSE -amount END) as total_equity
    FROM capital_ledger
  `;
  const totalFundEquity = parseFloat(totalEquityRes.rows[0]?.total_equity || 0);

  // Get Total Fund Unrealized Profit
  const perfData = await sql`
    SELECT SUM(unrealized_profit) as total_unrealized 
    FROM (
      SELECT unrealized_profit,
             ROW_NUMBER() OVER(PARTITION BY platform_id ORDER BY month DESC) as rn
      FROM platform_performance
    ) sub
    WHERE rn = 1;
  `;
  const totalFundUnrealized = parseFloat(perfData.rows[0]?.total_unrealized || 0);

  // My share of equity profit
  const myEquityProfitShare = totalFundEquity > 0 ? (myNetEquity / totalFundEquity) * totalFundUnrealized : 0;

  // 5. Totals for Display
  const totalDeposits = myEquityDeposits + mySavingsDeposits;
  const totalWithdrawals = myEquityWithdrawals + mySavingsWithdrawals;
  const totalProfit = myEquityProfitShare + myAccruedInterest;
  const netCapital = myNetEquity + myNetSavings + totalProfit;

  // 6. Fund Activity (Platforms)
  const platforms = await getPlatforms();

  return (
    <div className="min-h-screen bg-background p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Investor Portal</h1>
          <p className="text-muted-foreground">
            Welcome back, <span className="font-medium text-foreground">{investor.name}</span>. Here is your portfolio summary.
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm hover:shadow-md transition-all">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Net Value</CardTitle>
              <Wallet className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">RM {netCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </CardContent>
          </Card>
          
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm hover:shadow-md transition-all">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Deposits</CardTitle>
              <ArrowDownRight className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">RM {totalDeposits.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm hover:shadow-md transition-all">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Withdrawals</CardTitle>
              <ArrowUpRight className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">RM {totalWithdrawals.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm hover:shadow-md transition-all">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Earned Profit</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">RM {totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Includes interest & equity share</p>
            </CardContent>
          </Card>
        </div>

        {/* Fund Performance View (Read-Only) */}
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden mt-8">
          <CardHeader>
            <CardTitle>Fund Market Activity</CardTitle>
            <p className="text-sm text-muted-foreground">Current allocation and performance across trading platforms.</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Platform</TableHead>
                  <TableHead className="text-right">Net Invested</TableHead>
                  <TableHead className="text-right">Current Value</TableHead>
                  <TableHead className="text-right">Total Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {platforms.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-bold">{p.name}</TableCell>
                    <TableCell className="text-right">RM {p.netInvested.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-medium">RM {p.totalValue.toLocaleString()}</TableCell>
                    <TableCell className={`text-right font-bold ${p.unrealizedProfit >= 0 ? "text-green-500" : "text-red-500"}`}>
                      RM {p.unrealizedProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
                {platforms.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No platform activity recorded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
