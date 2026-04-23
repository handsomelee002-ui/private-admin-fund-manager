import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function CapitalLedgerPage() {
  const records = [
    {
      id: "CAP-001",
      investor: "Lee Che Hou",
      date: "2024-03-01",
      type: "Deposit",
      amount: "RM 200,000",
      notes: "Additional capital",
      receipt: "https://example.com/receipt.jpg"
    },
    {
      id: "CAP-002",
      investor: "Ng Siew Chin",
      date: "2024-04-12",
      type: "Withdrawal",
      amount: "RM 50,000",
      notes: "Dividend payout",
      receipt: null
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Capital Ledger</h1>
          <p className="text-muted-foreground mt-2">
            Record and view all deposits and withdrawals.
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Add Record
        </Button>
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Investor</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((rec) => (
                <TableRow key={rec.id}>
                  <TableCell>{rec.date}</TableCell>
                  <TableCell className="font-medium">{rec.investor}</TableCell>
                  <TableCell>
                    <Badge variant={rec.type === "Deposit" ? "default" : "destructive"}>
                      {rec.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-bold">{rec.amount}</TableCell>
                  <TableCell className="text-muted-foreground">{rec.notes}</TableCell>
                  <TableCell>
                    {rec.receipt ? (
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
