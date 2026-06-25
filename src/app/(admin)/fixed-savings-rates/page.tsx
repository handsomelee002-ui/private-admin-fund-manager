import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddBaseRateForm, AddPromotionForm } from "@/components/FixedSavingsRateForms";
import { DisablePromotionButton } from "@/components/DisablePromotionButton";
import { PaginationControls } from "@/components/PaginationControls";
import { getFixedSavingsRateSettings } from "@/lib/fundDb";
import { formatMoney } from "@/lib/formatting";
import { paginateRows } from "@/lib/pagination";
import { CalendarClock, Percent, Tags } from "lucide-react";

export const dynamic = "force-dynamic";

const metricHeaderClass = "flex min-h-12 flex-row items-start justify-between gap-3 pb-2";
const metricTitleClass = "text-sm leading-5 text-muted-foreground";
const metricValueClass = "text-[1.625rem] leading-8 font-bold whitespace-nowrap tabular-nums tracking-normal";

export default async function FixedSavingsRatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const settings = await getFixedSavingsRateSettings();
  const baseRates = [...settings.baseRates].sort((a: any, b: any) => {
    const dateOrder = String(b.effective_date).localeCompare(String(a.effective_date));
    if (dateOrder !== 0) return dateOrder;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
  const baseRatePagination = paginateRows(baseRates, resolvedSearchParams, "base");
  const promotionPagination = paginateRows(settings.promotions, resolvedSearchParams, "promo");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Fixed Savings Rates</h1>
          <p className="text-muted-foreground mt-1 text-sm">Nominal p.a. daily compounding rates and promotion periods.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddBaseRateForm />
          <AddPromotionForm />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Current Base Rate</CardTitle>
            <Percent className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          </CardHeader>
          <CardContent>
            <div className={metricValueClass}>{Number(settings.currentBaseRate).toFixed(4)}%</div>
            <p className="text-xs text-muted-foreground mt-1">Nominal p.a., credited daily</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50 md:col-span-2">
          <CardHeader className={metricHeaderClass}>
            <CardTitle className={metricTitleClass}>Rate Rule</CardTitle>
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Active promotions override the base rate for their date range. If a promotion has a cap, excess balance earns the base rate.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Percent className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Base Rate History</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Effective Date</TableHead>
                <TableHead className="text-right pr-6">Nominal p.a.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {baseRatePagination.pageRows.map((rate: any) => (
                <TableRow key={rate.id || rate.effective_date}>
                  <TableCell className="pl-6">{rate.effective_date}</TableCell>
                  <TableCell className="text-right pr-6 font-semibold">{Number(rate.annual_rate_percent).toFixed(4)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationControls {...baseRatePagination} searchParams={resolvedSearchParams} prefix="base" />
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Tags className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-base">Promotions</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Nominal p.a.</TableHead>
                <TableHead className="text-right">Cap</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[72px] pr-6 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promotionPagination.pageRows.map((promotion: any) => (
                <TableRow key={promotion.id}>
                  <TableCell className="pl-6 font-medium">{promotion.name}</TableCell>
                  <TableCell>{promotion.start_date} to {promotion.end_date}</TableCell>
                  <TableCell className="text-right font-semibold">{Number(promotion.annual_rate_percent).toFixed(4)}%</TableCell>
                  <TableCell className="text-right">{promotion.balance_cap ? formatMoney(promotion.balance_cap) : "-"}</TableCell>
                  <TableCell>
                    <Badge variant={promotion.status === "active" ? "default" : "outline"}>{promotion.status}</Badge>
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {promotion.status === "active" ? <DisablePromotionButton id={promotion.id} /> : null}
                  </TableCell>
                </TableRow>
              ))}
              {settings.promotions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-12">No promotions configured.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <PaginationControls {...promotionPagination} searchParams={resolvedSearchParams} prefix="promo" />
        </CardContent>
      </Card>
    </div>
  );
}
