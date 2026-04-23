import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getCapitalLedger, deleteCapitalRecord } from "@/actions/capital";
import { getInvestors } from "@/actions/investors";
import { AddCapitalForm } from "@/components/AddCapitalForm";
import { DeleteButton } from "@/components/DeleteButton";

export default async function CapitalLedgerPage() {
  const records = await getCapitalLedger();
  const investors = await getInvestors();

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Capital Ledger</h1>
          <p className="text-muted-foreground mt-2">
            Record and view all deposits and withdrawals.
          </p>
        </div>
        <AddCapitalForm investors={investors} />
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
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((rec: any) => (
                <TableRow key={rec.id}>
                  <TableCell>{rec.date}</TableCell>
                  <TableCell className="font-medium">{rec.investor_name}</TableCell>
                  <TableCell>
                    <Badge variant={rec.type === "Deposit" ? "default" : "destructive"}>
                      {rec.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-bold text-primary">
                    RM {parseFloat(rec.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{rec.notes}</TableCell>
                  <TableCell className="text-right">
                     <DeleteButton id={rec.id} deleteAction={deleteCapitalRecord} />
                  </TableCell>
                </TableRow>
              ))}
              {records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No capital records found.
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
