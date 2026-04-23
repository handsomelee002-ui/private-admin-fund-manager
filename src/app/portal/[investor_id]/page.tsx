import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, TrendingUp, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { sql } from "@vercel/postgres";

export default async function InvestorPortalPage({ params }: { params: Promise<{ investor_id: string }> }) {
  const resolvedParams = await params;
  const investor_id = resolvedParams.investor_id;

  // Fetch Investor Details
  const invRes = await sql`SELECT * FROM investors WHERE id = ${investor_id}`;
  const investorName = invRes.rows[0]?.name || "Unknown Investor";
  const totalDeposits = "RM 500,000";
  const totalWithdrawals = "RM 50,000";
  const shareOfProfit = "RM 12,500";
  const netCapital = "RM 462,500";

  const recentTrades = [
    { ticker: "AAPL", type: "Buy", amountRM: "RM 80,000", status: "Open", pnl: null },
    { ticker: "EURUSD", type: "Sell", amountRM: "RM 4,700", status: "Closed", pnl: "+ RM 1,200" },
  ];

  return (
    <div className="min-h-screen bg-background p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Investor Portal</h1>
          <p className="text-muted-foreground">
            Welcome back, <span className="font-medium text-foreground">{investorName}</span>. Here is your portfolio summary.
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm hover:shadow-md transition-all">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Net Capital</CardTitle>
              <Wallet className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{netCapital}</div>
            </CardContent>
          </Card>
          
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm hover:shadow-md transition-all">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Deposits</CardTitle>
              <ArrowDownRight className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalDeposits}</div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm hover:shadow-md transition-all">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Withdrawals</CardTitle>
              <ArrowUpRight className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalWithdrawals}</div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm hover:shadow-md transition-all">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Share of Profit</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">{shareOfProfit}</div>
            </CardContent>
          </Card>
        </div>

        {/* Fund Trades View (Read-Only) */}
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden mt-8">
          <CardHeader>
            <CardTitle>Fund Market Activity</CardTitle>
            <p className="text-sm text-muted-foreground">Recent open and closed trades made by the fund manager.</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount (RM)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Profit/Loss</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTrades.map((trade, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-bold">{trade.ticker}</TableCell>
                    <TableCell>{trade.type}</TableCell>
                    <TableCell className="text-right font-medium">{trade.amountRM}</TableCell>
                    <TableCell>
                      <Badge variant={trade.status === "Open" ? "default" : "secondary"}>
                        {trade.status}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right font-bold ${trade.pnl && trade.pnl.includes("+") ? "text-green-500" : ""}`}>
                      {trade.pnl || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
