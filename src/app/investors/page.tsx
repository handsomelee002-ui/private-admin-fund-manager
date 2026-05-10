import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getInvestors, deleteInvestor } from "@/actions/investors";
import { AddInvestorForm } from "@/components/AddInvestorForm";
import { DeleteButton } from "@/components/DeleteButton";
import { EditNameDialog } from "@/components/EditNameDialog";
import { updateInvestorName } from "@/actions/investors";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export default async function InvestorsPage() {
  const investors = await getInvestors();

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Investors</h1>
          <p className="text-muted-foreground mt-2">
            Manage your fund investors and view their total capital.
          </p>
        </div>
        <AddInvestorForm />
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader>
          <CardTitle>Directory</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Joined Date</TableHead>
                <TableHead className="text-right">Total Capital</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {investors.map((inv: any) => (
                <TableRow key={inv.id} className="group hover:bg-muted/50 transition-colors">
                  <TableCell className="font-medium text-primary">
                    <Link href={`/investors/${inv.id}`} className="flex items-center gap-1 hover:underline">
                      {inv.name}
                      <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </TableCell>
                  <TableCell>{inv.joined}</TableCell>
                  <TableCell className="text-right font-semibold text-green-500">
                    RM {parseFloat(inv.total_capital).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <EditNameDialog id={inv.id} currentName={inv.name} title="Edit Investor Name" updateAction={updateInvestorName} />
                      <DeleteButton id={inv.id} deleteAction={deleteInvestor} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {investors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No investors found. Add your first investor to begin.
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
