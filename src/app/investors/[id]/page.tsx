import { sql } from "@vercel/postgres";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getCapitalLedgerByInvestor, deleteCapitalRecord } from "@/actions/capital";
import { AddCapitalForm } from "@/components/AddCapitalForm";
import { DeleteButton } from "@/components/DeleteButton";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function InvestorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const id = resolvedParams.id;

  // Fetch investor details
  const invRes = await sql`SELECT * FROM investors WHERE id = ${id}`;
  const investor = invRes.rows[0];

  if (!investor) {
    return <div>Investor not found</div>;
  }

  const records = await getCapitalLedgerByInvestor(id);

  const totalDeposits = records.filter(r => r.type === 'Deposit').reduce((sum, r) => sum + parseFloat(r.amount), 0);
  const totalWithdrawals = records.filter(r => r.type === 'Withdrawal').reduce((sum, r) => sum + parseFloat(r.amount), 0);
  const netCapital = totalDeposits - totalWithdrawals;

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-4 mb-2">
             <Link href="/investors">
               <Button variant="outline" size="sm">← Back</Button>
             </Link>
             <h1 className="text-3xl font-bold tracking-tight">{investor.name}</h1>
          </div>
          <p className="text-muted-foreground">
            Detailed ledger and capital overview.
          </p>
        </div>
        <AddCapitalForm investors={[investor]} defaultInvestorId={investor.id} />
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Net Capital</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              RM {netCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Deposits</CardTitle>
            <ArrowDownRight className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              RM {totalDeposits.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Withdrawals</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              RM {totalWithdrawals.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader>
          <CardTitle>Personal Capital Ledger</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
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
                  <TableCell>
                    <Badge variant={rec.type === "Deposit" ? "default" : "destructive"}>
                      {rec.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-bold text-primary">
                    RM {parseFloat(rec.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{rec.notes}</TableCell>
                  <TableCell className="text-right">
                    <DeleteButton id={rec.id} deleteAction={deleteCapitalRecord} />
                  </TableCell>
                </TableRow>
              ))}
              {records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No records found for this investor.
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
