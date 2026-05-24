import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RevertAuditLogButton } from "@/components/RevertAuditLogButton";
import { getAdminAuditLogs } from "@/actions/adminLogs";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

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

export default async function AdminLogsPage() {
  const logs = await getAdminAuditLogs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin Logs</h1>
        <p className="text-muted-foreground mt-1 text-sm">Immutable financial activity log with controlled transaction revert.</p>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Audit History</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-6 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log: any) => (
                <TableRow key={log.id}>
                  <TableCell className="pl-6 text-sm">{log.created_at}</TableCell>
                  <TableCell className="font-medium">{log.action}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <div>{log.entity_type}</div>
                    <div className="max-w-[180px] truncate text-xs">{log.entity_id || "-"}</div>
                  </TableCell>
                  <TableCell className="max-w-[420px] truncate text-muted-foreground">{describeLog(log)}</TableCell>
                  <TableCell>
                    {log.action.endsWith(".revert") ? (
                      <Badge variant="outline">Reversal</Badge>
                    ) : log.has_revert ? (
                      <Badge variant="destructive">Reverted</Badge>
                    ) : (
                      <Badge variant="default">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    <RevertAuditLogButton id={log.id} disabled={!log.canRevert} />
                  </TableCell>
                </TableRow>
              ))}
              {logs.length === 0 && (
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
