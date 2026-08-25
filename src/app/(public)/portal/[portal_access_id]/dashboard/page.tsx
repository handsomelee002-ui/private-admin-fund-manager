import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NoPrefetchLink } from "@/components/NoPrefetchLink";
import { FundNavChart, InvestorValueChart } from "@/components/InvestorPortalCharts";
import { PlatformAllocationPieChart } from "@/components/PlatformAllocationPieChart";
import { getInvestorDashboardByPortalAccessId } from "@/lib/fundDb";
import { formatMoney, formatPercent, formatUnits } from "@/lib/formatting";
import { Banknote, LineChart, ListOrdered, Percent, PieChart, TrendingUp, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

const metricHeaderClass = "flex min-h-12 flex-row items-start justify-between gap-3 pb-2";
const metricTitleClass = "text-sm leading-5 text-muted-foreground";
const metricValueClass = "text-[1.625rem] leading-8 font-bold whitespace-nowrap tabular-nums tracking-normal";

function signedMoney(value: number) {
  return `${value > 0 ? "+" : ""}${formatMoney(value)}`;
}

export default async function InvestorPortalDashboardPage({
  params,
}: {
  params: Promise<{ portal_access_id: string }>;
}) {
  const { portal_access_id } = await params;
  const headerStore = await headers();
  const forwardedFor = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || headerStore.get("x-real-ip") || "unknown";
  const userAgent = headerStore.get("user-agent") || "unknown";
  const clientKey = createHash("sha256").update(`${ip}|${userAgent}`).digest("base64url");

  // Same access path as the activity page: rate limit and audit event included.
  const data = await getInvestorDashboardByPortalAccessId(portal_access_id, { clientKey, userAgent }).catch(() => null);
  if (!data) notFound();
  const { statement, valueHistory, navHistory, platformAllocation } = data;

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{statement.investor.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Your position, performance, and where the fund is invested.</p>
          </div>
          <NoPrefetchLink
            href={`/portal/${portal_access_id}`}
            className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            <ListOrdered className="h-4 w-4" />
            Activity Ledger
          </NoPrefetchLink>
        </div>

        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
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
              <CardTitle className={metricTitleClass}>Net Invested</CardTitle>
              <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
            </CardHeader>
            <CardContent><div className={`${metricValueClass} text-sky-400`}>{formatMoney(statement.netInvestedCapital)}</div></CardContent>
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
            <CardContent><div className={`${metricValueClass} text-amber-400`}>{formatMoney(statement.savingsBalance)}</div></CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="bg-card/50 border-border/50 lg:col-span-2">
            <CardHeader className="pb-0">
              <div className="flex items-center gap-2">
                <LineChart className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Your Value Over Time</CardTitle>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Holding value each week against what you have put in. The gap between the two is your gain or loss.
              </p>
            </CardHeader>
            <CardContent><InvestorValueChart data={valueHistory} /></CardContent>
          </Card>

          <Card className="bg-card/50 border-border/50">
            <CardHeader className="pb-0">
              <div className="flex items-center gap-2">
                <PieChart className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Where the Fund Is Invested</CardTitle>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Share of fund assets per platform. Percentages only.
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-[260px] min-h-[260px] w-full min-w-0 pt-4">
                <PlatformAllocationPieChart
                  valueMode="percent"
                  data={platformAllocation.map((slice) => ({ name: slice.name, value: slice.percent }))}
                />
              </div>
              <div className="mt-2 space-y-1">
                {platformAllocation.map((slice) => (
                  <div key={slice.name} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-muted-foreground">{slice.name}</span>
                    <Badge variant="outline" className="tabular-nums">{slice.percent.toFixed(2)}%</Badge>
                  </div>
                ))}
                {platformAllocation.length === 0 && (
                  <p className="text-xs text-muted-foreground">No platform allocation available yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-0">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Fund NAV per Unit</CardTitle>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              The fund&apos;s unit price at each locked valuation. Your value moves with this and with the units you hold.
            </p>
          </CardHeader>
          <CardContent>
            <FundNavChart data={navHistory} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
