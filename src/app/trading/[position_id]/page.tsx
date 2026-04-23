import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getTradingLedgerByPosition, deleteTrade, getPositions } from "@/actions/trading";
import { AddTradeForm } from "@/components/AddTradeForm";
import { DeleteButton } from "@/components/DeleteButton";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Briefcase, ArrowUpRight, TrendingUp } from "lucide-react";

export default async function TickerDetailPage({ params }: { params: Promise<{ position_id: string }> }) {
  const resolvedParams = await params;
  const position_id = decodeURIComponent(resolvedParams.position_id);

  const trades = await getTradingLedgerByPosition(position_id);
  const positions = await getPositions();
  const summary = positions.find((p: any) => p.position_id === position_id);
  const ticker = summary?.ticker || trades[0]?.ticker || "Position";

  if (!summary && trades.length === 0) {
    return <div>Position not found</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-4 mb-2">
             <Link href="/trading">
               <Button variant="outline" size="sm">← Back</Button>
             </Link>
             <h1 className="text-3xl font-bold tracking-tight">{ticker}</h1>
          </div>
          <p className="text-muted-foreground">
            Detailed trading history and position overview.
          </p>
        </div>
        <AddTradeForm defaultTicker={ticker} defaultPositionId={position_id} />
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Net Quantity Held</CardTitle>
            <Briefcase className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary ? parseFloat(summary.net_quantity).toString() : "0"} units
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Net Invested Amount</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              RM {summary ? parseFloat(summary.net_invested).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "0.00"}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Realized P/L</CardTitle>
            <TrendingUp className={`h-4 w-4 ${summary && parseFloat(summary.total_profit) >= 0 ? "text-green-500" : "text-destructive"}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary && parseFloat(summary.total_profit) >= 0 ? "text-green-500" : summary?.total_profit ? "text-destructive" : ""}`}>
              {summary && summary.total_profit ? `RM ${parseFloat(summary.total_profit).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "RM 0.00"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
        <CardHeader>
          <CardTitle>Trade History</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="whitespace-nowrap">
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead className="text-right">Amount (RM)</TableHead>
                <TableHead className="text-right">P/L (RM)</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade: any) => (
                <TableRow key={trade.id} className="whitespace-nowrap">
                  <TableCell>{trade.date}</TableCell>
                  <TableCell>
                    <Badge variant={trade.type === "Buy" ? "default" : "secondary"}>
                      {trade.type}
                    </Badge>
                  </TableCell>
                  <TableCell>{trade.currency} {parseFloat(trade.price).toFixed(2)}</TableCell>
                  <TableCell>{parseFloat(trade.quantity).toString()}</TableCell>
                  <TableCell className="text-right font-medium">
                    {parseFloat(trade.amount_rm).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className={`text-right font-bold ${trade.profit_loss && parseFloat(trade.profit_loss) >= 0 ? "text-green-500" : trade.profit_loss ? "text-destructive" : ""}`}>
                    {trade.profit_loss ? parseFloat(trade.profit_loss).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}
                  </TableCell>
                  <TableCell className="text-right flex items-center justify-end gap-1">
                    <DeleteButton id={trade.id} deleteAction={deleteTrade} />
                  </TableCell>
                </TableRow>
              ))}
              {trades.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No trades recorded for this ticker.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
