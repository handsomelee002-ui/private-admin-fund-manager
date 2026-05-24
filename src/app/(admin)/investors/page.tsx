import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddInvestorForm } from "@/components/AddInvestorForm";
import { DeleteButton } from "@/components/DeleteButton";
import { EditNameDialog } from "@/components/EditNameDialog";
import { SortableTableHead } from "@/components/SortableTableHead";
import { PortalAccessControl } from "@/components/PortalAccessControl";
import { deleteInvestor, getInvestors, updateInvestorName } from "@/actions/investors";
import { formatMoney, formatUnits } from "@/lib/formatting";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { ChevronRight, Users } from "lucide-react";

export const dynamic = "force-dynamic";

const investorSorts = ["investor", "joined", "units", "ownership", "netInvested", "marketValue", "fixedSavings"] as const;

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, investorSorts, { sort: "joined", dir: "desc" });
  const investors = await getInvestors();
  const sortedInvestors = sortRows(investors, sortState, {
    investor: (investor: any) => investor.name,
    joined: (investor: any) => investor.joined,
    units: (investor: any) => investor.units,
    ownership: (investor: any) => investor.ownershipPercent,
    netInvested: (investor: any) => investor.netInvestedCapital,
    marketValue: (investor: any) => investor.marketValue,
    fixedSavings: (investor: any) => investor.fixedSavingsBalance,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Investors</h1>
          <p className="text-muted-foreground mt-1 text-sm">Unit balances and ownership from the fresh weekly NAV model.</p>
        </div>
        <AddInvestorForm />
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Directory</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead className="pl-6" sortKey="investor" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Investor</SortableTableHead>
                <SortableTableHead sortKey="joined" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Joined</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="units" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Units</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="ownership" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Ownership</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="netInvested" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Net Invested</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="marketValue" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Market Value</SortableTableHead>
                <SortableTableHead className="text-right" sortKey="fixedSavings" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Fixed Savings</SortableTableHead>
                <TableHead className="text-right">Portal</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedInvestors.map((investor: any) => (
                <TableRow key={investor.id} className="group">
                  <TableCell className="pl-6">
                    <Link href={`/investors/${investor.id}`} className="flex items-center gap-3 w-fit">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
                        {investor.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-semibold text-sm hover:text-primary flex items-center gap-1">
                        {investor.name}
                        <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{investor.joined}</TableCell>
                  <TableCell className="text-right">{formatUnits(investor.units)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline">{investor.ownershipPercent.toFixed(4)}%</Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{formatMoney(investor.netInvestedCapital)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatMoney(investor.marketValue)}</TableCell>
                  <TableCell className="text-right font-semibold text-amber-400">{formatMoney(investor.fixedSavingsBalance)}</TableCell>
                  <TableCell className="text-right">
                    <PortalAccessControl investorId={investor.id} initialPortalAccessId={investor.portal_access_id} />
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <div className="flex justify-end gap-2">
                      <EditNameDialog id={investor.id} currentName={investor.name} title="Edit Investor Name" updateAction={updateInvestorName} />
                      <DeleteButton id={investor.id} deleteAction={deleteInvestor} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {sortedInvestors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                    No investors found.
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
