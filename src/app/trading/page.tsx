import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function TradingLedgerPage() {
  const trades = [
    {
      id: "TRD-001",
      date: "2024-03-05",
      platform: "Moomoo",
      ticker: "AAPL",
      type: "Buy",
      currency: "USD",
      price: "170.00",
      quantity: "100",
      amountRM: "RM 80,000",
      profitLoss: null,
      dateClosed: null,
      receipt: "https://example.com/receipt.jpg"
    },
    {
      id: "TRD-002",
      date: "2024-02-10",
      platform: "MT5",
      ticker: "EURUSD",
      type: "Sell",
      currency: "USD",
      price: "1.0800",
      quantity: "1 Lot",
      amountRM: "RM 4,700",
      profitLoss: "+ RM 1,200",
      dateClosed: "2024-02-12",
      receipt: null
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trading Ledger</h1>
          <p className="text-muted-foreground mt-2">
            Record all trades and manage realized profit/loss.
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Add Trade
        </Button>
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
                <TableHead>Platform</TableHead>
                <TableHead>Ticker</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead className="text-right">Amount (RM)</TableHead>
                <TableHead className="text-right">P/L</TableHead>
                <TableHead>Date Closed</TableHead>
                <TableHead>Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => (
                <TableRow key={trade.id} className="whitespace-nowrap">
                  <TableCell>{trade.date}</TableCell>
                  <TableCell>{trade.platform}</TableCell>
                  <TableCell className="font-bold">{trade.ticker}</TableCell>
                  <TableCell>
                    <Badge variant={trade.type === "Buy" ? "default" : "secondary"}>
                      {trade.type}
                    </Badge>
                  </TableCell>
                  <TableCell>{trade.currency} {trade.price}</TableCell>
                  <TableCell>{trade.quantity}</TableCell>
                  <TableCell className="text-right font-medium">{trade.amountRM}</TableCell>
                  <TableCell className={`text-right font-bold ${trade.profitLoss && trade.profitLoss.includes("+") ? "text-green-500" : ""}`}>
                    {trade.profitLoss || "-"}
                  </TableCell>
                  <TableCell>{trade.dateClosed || "-"}</TableCell>
                  <TableCell>
                    {trade.receipt ? (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-primary">
                        <ReceiptText className="h-4 w-4" />
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
