import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddPlatformForm } from "@/components/AddPlatformForm";
import { CreateNavWeekForm } from "@/components/CreateNavWeekForm";
import { LockNavButton } from "@/components/LockNavButton";
import { getPlatforms } from "@/actions/trading";
import { getNavWeeks } from "@/lib/fundDb";
import { formatMoney, formatUnits } from "@/lib/formatting";
import { CalendarClock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NavPage() {
  const [navWeeks, platforms] = await Promise.all([getNavWeeks(), getPlatforms()]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Weekly NAV</h1>
          <p className="text-muted-foreground mt-1 text-sm">Locked platform snapshots are the source of truth for unit pricing.</p>
        </div>
        <div className="flex gap-2">
          <AddPlatformForm />
          <CreateNavWeekForm platforms={platforms} />
        </div>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">NAV Register</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Week Ending</TableHead>
                <TableHead className="text-right">Gross Assets</TableHead>
                <TableHead className="text-right">Net Asset Value</TableHead>
                <TableHead className="text-right">Total Units</TableHead>
                <TableHead className="text-right">NAV / Unit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right pr-6">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {navWeeks.map((week: any) => (
                <TableRow key={week.id}>
                  <TableCell className="pl-6 font-medium">{week.week_ending}</TableCell>
                  <TableCell className="text-right">{formatMoney(week.gross_assets)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatMoney(week.net_asset_value)}</TableCell>
                  <TableCell className="text-right">{formatUnits(week.total_units)}</TableCell>
                  <TableCell className="text-right font-semibold text-primary">{Number(week.nav_per_unit).toFixed(6)}</TableCell>
                  <TableCell>
                    <Badge variant={week.status === "locked" ? "default" : "outline"}>{week.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    {week.status === "draft" ? <LockNavButton id={week.id} /> : null}
                  </TableCell>
                </TableRow>
              ))}
              {navWeeks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                    No NAV weeks recorded. Add a platform, create a draft NAV, then lock it before recording capital movements.
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
