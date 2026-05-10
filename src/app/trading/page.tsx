import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPlatforms, deletePlatform, updatePlatformName } from "@/actions/trading";
import { AddPlatformForm } from "@/components/AddPlatformForm";
import { DeleteButton } from "@/components/DeleteButton";
import { EditNameDialog } from "@/components/EditNameDialog";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export default async function TradingLedgerPage() {
  const platforms = await getPlatforms();

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trading Ledger</h1>
          <p className="text-muted-foreground mt-2">
            Manage your trading platforms, capital flows, and performance.
          </p>
        </div>
        <AddPlatformForm />
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader>
          <CardTitle>Trading Platforms</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Platform Name</TableHead>
                <TableHead className="text-right">Net Invested</TableHead>
                <TableHead className="text-right">Latest Unrealized</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {platforms.map((platform: any) => (
                <TableRow key={platform.id} className="group hover:bg-muted/50 transition-colors">
                  <TableCell className="font-medium text-primary">
                    <Link href={`/trading/${platform.id}`} className="flex items-center gap-1 hover:underline">
                      {platform.name}
                      <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    RM {platform.netInvested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-medium text-blue-500">
                    RM {platform.unrealizedProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-bold text-green-500">
                    RM {platform.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <EditNameDialog id={platform.id} currentName={platform.name} title="Edit Platform Name" updateAction={updatePlatformName} />
                      <DeleteButton id={platform.id} deleteAction={deletePlatform} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {platforms.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No trading platforms found. Add your first platform to begin.
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
