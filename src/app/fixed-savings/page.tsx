import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddFixedSavingsMovementForm } from "@/components/AddFixedSavingsMovementForm";
import { getInvestors } from "@/actions/investors";
import { getFixedSavingsLedger } from "@/lib/fundDb";
import { formatMoney } from "@/lib/formatting";
import { Banknote } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FixedSavingsPage() {
  const [records, investors] = await Promise.all([getFixedSavingsLedger(), getInvestors()]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fixed Savings</h1>
          <p className="text-muted-foreground mt-1 text-sm">Liability book excluded from equity unit NAV.</p>
        </div>
        <AddFixedSavingsMovementForm investors={investors} />
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-base">Savings Ledger</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Date</TableHead>
                <TableHead>Investor</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="pr-6">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record: any) => (
                <TableRow key={record.id}>
                  <TableCell className="pl-6">{record.date}</TableCell>
                  <TableCell className="font-medium">{record.investor_name}</TableCell>
                  <TableCell>
                    <Badge variant={record.type === "Deposit" ? "default" : "destructive"}>{record.type}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{formatMoney(record.amount)}</TableCell>
                  <TableCell className="text-right">{record.annual_rate_percent ? `${Number(record.annual_rate_percent).toFixed(4)}%` : "-"}</TableCell>
                  <TableCell className="pr-6 text-muted-foreground">{record.notes}</TableCell>
                </TableRow>
              ))}
              {records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                    No fixed savings records.
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
