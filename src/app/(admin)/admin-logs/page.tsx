import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AuditLogDetailsButton } from "@/components/AuditLogDetailsButton";
import { NoPrefetchLink } from "@/components/NoPrefetchLink";
import { RevertAuditLogButton } from "@/components/RevertAuditLogButton";
import { getAdminAuditLogs } from "@/actions/adminLogs";
import { timeAsync } from "@/lib/serverTiming";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;

function describeLog(log: any) {
  const details = log.details ?? {};
  if (log.action === "platform_transaction.add") {
    return `${details.type ?? "Transaction"} RM ${Number(details.amount ?? 0).toLocaleString()}${details.realizedProfit ? `, realized RM ${Number(details.realizedProfit).toLocaleString()}` : ""}`;
  }
  if (log.action === "cash_movement.add") {
    return `${details.type ?? "Movement"} RM ${Number(details.amount ?? 0).toLocaleString()}${details.units ? `, ${Number(details.units).toLocaleString()} units` : ""}`;
  }
  if (log.action === "fixed_savings.add") {
    return `${details.type ?? "Movement"} RM ${Number(details.amount ?? 0).toLocaleString()}`;
  }
  if (log.action === "bonus_payment.add") {
    return `${details.ledgerType ?? "bonus"} RM ${Number(details.amount ?? 0).toLocaleString()}`;
  }
  if (log.action.endsWith(".revert")) {
    return `Reverted audit log ${details.originalAuditEventId ?? "-"}`;
  }
  return JSON.stringify(details);
}

function statusBadge(log: any) {
  if (log.action.endsWith(".revert")) return <Badge variant="outline">Reversal</Badge>;
  if (log.has_revert) return <Badge variant="destructive">Reverted</Badge>;
  return <Badge variant="default">Active</Badge>;
}

function actionLabel(action: string) {
  return action.replaceAll("_", " ").replaceAll(".", " / ");
}

export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const logs = await timeAsync("route.adminLogs.getAdminAuditLogs", () => getAdminAuditLogs(), { route: "/admin-logs" });
  const pageParam = typeof resolvedSearchParams.page === "string" ? Number(resolvedSearchParams.page) : 1;
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const pageCount = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleLogs = logs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const showingStart = logs.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const showingEnd = Math.min(currentPage * PAGE_SIZE, logs.length);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin Logs</h1>
          <p className="text-muted-foreground mt-1 text-sm">Immutable financial activity log with controlled transaction revert.</p>
        </div>
        <div className="text-xs text-muted-foreground">
          Showing {showingStart}-{showingEnd} of {logs.length}
        </div>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader className="py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Audit History</CardTitle>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <NoPrefetchLink
                  href={`/admin-logs?page=${Math.max(1, currentPage - 1)}`}
                  className={`rounded-md border px-3 py-1.5 ${currentPage === 1 ? "pointer-events-none text-muted-foreground opacity-50" : "hover:bg-muted"}`}
                >
                  Previous
                </NoPrefetchLink>
                <span className="text-muted-foreground">Page {currentPage} / {pageCount}</span>
                <NoPrefetchLink
                  href={`/admin-logs?page=${Math.min(pageCount, currentPage + 1)}`}
                  className={`rounded-md border px-3 py-1.5 ${currentPage === pageCount ? "pointer-events-none text-muted-foreground opacity-50" : "hover:bg-muted"}`}
                >
                  Next
                </NoPrefetchLink>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="table-fixed text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[132px] pl-4 text-xs">Time</TableHead>
                <TableHead className="w-[190px] text-xs">Action</TableHead>
                <TableHead className="text-xs">Summary</TableHead>
                <TableHead className="w-[92px] text-xs">Status</TableHead>
                <TableHead className="w-[52px] text-right text-xs">Info</TableHead>
                <TableHead className="w-[58px] pr-4 text-right text-xs">Revert</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLogs.map((log: any) => (
                <TableRow key={log.id} className="h-10">
                  <TableCell className="pl-4 text-[11px] tabular-nums text-muted-foreground">{log.created_at}</TableCell>
                  <TableCell className="truncate font-medium">{actionLabel(log.action)}</TableCell>
                  <TableCell className="truncate text-muted-foreground">{describeLog(log)}</TableCell>
                  <TableCell>{statusBadge(log)}</TableCell>
                  <TableCell className="text-right">
                    <AuditLogDetailsButton log={log} />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <RevertAuditLogButton id={log.id} disabled={!log.canRevert} compact />
                  </TableCell>
                </TableRow>
              ))}
              {visibleLogs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    No audit logs recorded.
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
