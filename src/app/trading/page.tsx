import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPositions } from "@/actions/trading";
import { AddTradeForm } from "@/components/AddTradeForm";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default async function TradingLedgerPage() {
  const positions = await getPositions();

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
          <p className="text-muted-foreground mt-2">
            Overview of your active and closed positions.
          </p>
        </div>
        <AddTradeForm />
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
        <CardHeader>
          <CardTitle>Positions</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="whitespace-nowrap">
                <TableHead>Ticker</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead className="text-right">Net Quantity Held</TableHead>
                <TableHead className="text-right">Net Invested (RM)</TableHead>
                <TableHead className="text-right">Total Realized P/L (RM)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((pos: any) => {
                const isClosed = parseFloat(pos.net_quantity) === 0;
                return (
                  <TableRow key={pos.position_id} className="whitespace-nowrap group hover:bg-muted/50 transition-colors">
                    <TableCell className="font-bold text-primary">
                      <Link href={`/trading/${pos.position_id}`} className="flex items-center gap-1 hover:underline">
                        {pos.ticker}
                        <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    </TableCell>
                    <TableCell>{pos.platform}</TableCell>
                    <TableCell className="text-right font-medium">
                      {parseFloat(pos.net_quantity).toString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {parseFloat(pos.net_invested).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className={`text-right font-bold ${pos.total_profit && parseFloat(pos.total_profit) >= 0 ? "text-green-500" : pos.total_profit ? "text-destructive" : ""}`}>
                      {pos.total_profit ? parseFloat(pos.total_profit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isClosed ? "secondary" : "default"}>
                        {isClosed ? "Closed" : "Active"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {positions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No positions found. Add a trade to start tracking.
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
