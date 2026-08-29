import { NoPrefetchLink } from "@/components/NoPrefetchLink";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddCashMovementForm } from "@/components/AddCashMovementForm";
import { AddFixedSavingsMovementForm } from "@/components/AddFixedSavingsMovementForm";
import { NotesTableCell } from "@/components/NotesTableCell";
import { PaginationControls } from "@/components/PaginationControls";
import { SortableTableHead } from "@/components/SortableTableHead";
import { getInvestors } from "@/actions/investors";
import { getInvestorStatement } from "@/lib/fundDb";
import { requireSession } from "@/lib/auth";
import { formatMoney, formatPercent, formatUnits } from "@/lib/formatting";
import { paginateRows } from "@/lib/pagination";
import { getSortState, sortRows } from "@/lib/tableSorting";
import { ArrowLeft, Banknote, Filter, Percent, TrendingUp, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

const activitySorts = ["date", "ledger", "type", "units", "nav", "amount"] as const;
const metricHeaderClass = "flex min-h-12 flex-row items-start justify-between gap-3 pb-2";
const metricTitleClass = "text-sm leading-5 text-muted-foreground";
const metricValueClass = "text-[1.625rem] leading-8 font-bold whitespace-nowrap tabular-nums tracking-normal";

function signedMoney(value: number) {
  return `${value > 0 ? "+" : ""}${formatMoney(value)}`;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function ledgerFilterHref(investorId: string, searchParams: Record<string, string | string[] | undefined>, ledger: string) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const normalized = firstValue(value);
    if (normalized && key !== "ledger" && key !== "status" && key !== "page") params.set(key, normalized);
  }
  if (ledger !== "all") params.set("ledger", ledger);
  const query = params.toString();
  return `/investors/${investorId}${query ? `?${query}` : ""}`;
}

export default async function InvestorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const sortState = getSortState(resolvedSearchParams, activitySorts, { sort: "date", dir: "desc" });
  const requestedLedger = typeof resolvedSearchParams.ledger === "string" ? resolvedSearchParams.ledger : "all";
  const [statement, investors] = await Promise.all([
    getInvestorStatement(id),
    getInvestors(),
  ]);
  if (!statement) notFound();
  const ledgerOptions = Array.from(new Set(statement.activityLedger.map((row: any) => String(row.category)))).sort();
  const ledgerFilter = requestedLedger === "all" || ledgerOptions.includes(requestedLedger) ? requestedLedger : "all";
  const visibleActivityLedger = ledgerFilter === "all"
    ? statement.activityLedger
    : statement.activityLedger.filter((row: any) => row.category === ledgerFilter);
  const ledgerCounts = new Map<string, number>();
  for (const row of statement.activityLedger) {
    ledgerCounts.set(row.category, (ledgerCounts.get(row.category) ?? 0) + 1);
  }
  const sortedActivityLedger = sortRows(visibleActivityLedger, sortState, {
    date: (row: any) => row.date,
    ledger: (row: any) => row.category,
    type: (row: any) => row.type,
    units: (row: any) => row.units,
    nav: (row: any) => row.navPerUnit,
    amount: (row: any) => row.amount,
  });
  const activityPagination = paginateRows(sortedActivityLedger, resolvedSearchParams);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <NoPrefetchLink href="/investors">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </NoPrefetchLink>
            <h1 className="text-3xl font-bold tracking-tight">{statement.investor.name}</h1>
          </div>
        </div>
        <div className="flex gap-2">
          <AddCashMovementForm investors={investors} defaultInvestorId={id} />
          <AddFixedSavingsMovementForm investors={investors} defaultInvestorId={id} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Net Invested</CardTitle>
            <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          </CardHeader>
          <CardContent><div className={`${metricValueClass} text-sky-400`}>{formatMoney(statement.netInvestedCapital)}</div></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Market Value</CardTitle>
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          </CardHeader>
          <CardContent>
            <div className={metricValueClass}>{formatMoney(statement.marketValue)}</div>
            <p
              className={`text-xs mt-1 ${statement.equityPnlAmount >= 0 ? "text-emerald-400" : "text-red-400"}`}
              title="Equity P&L equals current market value minus remaining equity cost basis."
            >
              {signedMoney(statement.equityPnlAmount)} | {formatPercent(statement.equityReturnPercent, { signed: true })}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Units</CardTitle>
            <Percent className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          </CardHeader>
          <CardContent><div className={metricValueClass}>{formatUnits(statement.units)}</div></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Ownership</CardTitle>
            <Percent className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          </CardHeader>
          <CardContent><div className={`${metricValueClass} text-violet-400`}>{statement.ownershipPercent.toFixed(4)}%</div></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Fixed Savings</CardTitle>
            <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className={`${metricValueClass} text-amber-400`}>{formatMoney(statement.savingsBalance)}</div>
            <p className="text-xs text-muted-foreground mt-1">Curr accrued: {formatMoney(statement.savingsAccruedInterest)}</p>
            <p className="text-xs text-muted-foreground mt-1">Net accrued: {formatMoney(statement.savingsTotalAccruedInterest)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">Activity Ledger</CardTitle>
              <p className="text-xs text-muted-foreground">
                Showing {activityPagination.showingStart}-{activityPagination.showingEnd} of {sortedActivityLedger.length} records
              </p>
            </div>
            <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/50 bg-background/40 p-1">
              <div className="hidden items-center gap-1 px-2 text-xs font-medium text-muted-foreground sm:flex">
                <Filter className="h-3.5 w-3.5" />
                Ledger
              </div>
              <div className="flex min-w-0 gap-1 overflow-x-auto">
                <NoPrefetchLink
                  className={`inline-flex shrink-0 items-center gap-2 rounded px-2.5 py-1.5 text-sm transition-colors ${ledgerFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  href={ledgerFilterHref(id, resolvedSearchParams, "all")}
                >
                  All
                  <span className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums ${ledgerFilter === "all" ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground"}`}>
                    {statement.activityLedger.length}
                  </span>
                </NoPrefetchLink>
                {ledgerOptions.map((ledger) => (
                  <NoPrefetchLink
                    key={ledger}
                    className={`inline-flex shrink-0 items-center gap-2 rounded px-2.5 py-1.5 text-sm transition-colors ${ledgerFilter === ledger ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                    href={ledgerFilterHref(id, resolvedSearchParams, ledger)}
                  >
                    {ledger}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums ${ledgerFilter === ledger ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground"}`}>
                      {ledgerCounts.get(ledger) ?? 0}
                    </span>
                  </NoPrefetchLink>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <SortableTableHead className="w-[116px] pl-6" sortKey="date" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Date</SortableTableHead>
                <SortableTableHead className="w-[132px]" sortKey="ledger" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Ledger</SortableTableHead>
                <SortableTableHead className="w-[116px]" sortKey="type" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Type</SortableTableHead>
                <SortableTableHead className="w-[96px] text-right" sortKey="units" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Units</SortableTableHead>
                <SortableTableHead className="w-[112px] text-right" sortKey="nav" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>NAV / Unit</SortableTableHead>
                <SortableTableHead className="w-[120px] text-right" sortKey="amount" activeSort={sortState.sort} activeDir={sortState.dir} searchParams={resolvedSearchParams}>Amount</SortableTableHead>
                <TableHead className="w-[180px] pr-6">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activityPagination.pageRows.map((row: any) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-6">{row.date}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.category}</TableCell>
                  <TableCell>
                    <Badge variant={["UnitIssue", "BonusIssue", "Deposit", "Bonus", "BonusAccrued"].includes(row.type) ? "default" : "destructive"}>{row.type}</Badge>
                    {row.auditStatus !== "active" && <Badge variant="outline" className="ml-2">{row.auditStatus === "reversal" ? "Reversal" : "Reverted"}</Badge>}
                  </TableCell>
                  <TableCell className="text-right">{row.units ? formatUnits(row.units) : "-"}</TableCell>
                  <TableCell className="text-right">{row.navPerUnit ? Number(row.navPerUnit).toFixed(6) : "-"}</TableCell>
                  <TableCell className={`text-right font-semibold ${row.amount >= 0 ? "" : "text-red-400"}`}>{formatMoney(row.amount)}</TableCell>
                  <NotesTableCell value={row.notes} />
                </TableRow>
              ))}
              {sortedActivityLedger.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">No investor activity.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <PaginationControls {...activityPagination} searchParams={resolvedSearchParams} />
        </CardContent>
      </Card>
    </div>
  );
}
