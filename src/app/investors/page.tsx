import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getInvestors, deleteInvestor } from "@/actions/investors";
import { AddInvestorForm } from "@/components/AddInvestorForm";
import { DeleteButton } from "@/components/DeleteButton";
import { EditNameDialog } from "@/components/EditNameDialog";
import { updateInvestorName } from "@/actions/investors";
import { sql } from "@vercel/postgres";
import { calcDailyCompoundInterest } from "@/lib/savingsUtils";
import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";

export default async function InvestorsPage() {
  const investors = await getInvestors();

  // Fund-level totals for equity % calculation
  const totalFundEquityRes = await sql`
    SELECT COALESCE(SUM(CASE WHEN type IN ('Deposit','Bonus') THEN amount WHEN type = 'Withdrawal' THEN -amount ELSE 0 END), 0) as total
    FROM capital_ledger
  `;
  const totalFundEquity = parseFloat(totalFundEquityRes.rows[0]?.total || 0);

  // Total unrealized for profit share
  const perfRes = await sql`
    SELECT SUM(unrealized_profit) as total
    FROM (
      SELECT unrealized_profit,
             ROW_NUMBER() OVER(PARTITION BY platform_id ORDER BY month DESC) as rn
      FROM platform_performance
    ) sub WHERE rn = 1
  `;
  const totalUnrealized = parseFloat(perfRes.rows[0]?.total || 0);

  // Accrued interest per investor
  const fsRows = await sql`
    SELECT investor_id, amount, interest_rate, TO_CHAR(date, 'YYYY-MM-DD') as date
    FROM fixed_savings_ledger
    WHERE type = 'Deposit' AND interest_rate IS NOT NULL AND interest_rate > 0
  `;
  const accruedMap = new Map<string, number>();
  for (const r of fsRows.rows) {
    const a = calcDailyCompoundInterest(parseFloat(r.amount), parseFloat(r.interest_rate), r.date);
    accruedMap.set(r.investor_id, (accruedMap.get(r.investor_id) || 0) + a);
  }

  // Gross invested capital (deposits + bonuses) per investor for ROI denominator
  const grossCapitalRes = await sql`
    SELECT
      investor_id,
      COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Bonus') THEN amount ELSE 0 END), 0) as gross_invested,
      COALESCE(SUM(CASE WHEN type = 'Withdrawal' THEN amount ELSE 0 END), 0) as gross_withdrawn
    FROM capital_ledger
    GROUP BY investor_id
  `;
  const grossCapitalMap = new Map(
    grossCapitalRes.rows.map((r: any) => [
      r.investor_id,
      { invested: parseFloat(r.gross_invested), withdrawn: parseFloat(r.gross_withdrawn) },
    ]),
  );

  const fmt = (n: number) =>
    `RM ${parseFloat(String(n)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Investors
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your fund investors and their capital.
          </p>
        </div>
        <AddInvestorForm />
      </div>

      {/* ── Directory Table ─────────────────────────────────────────────────── */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Directory</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50 hover:bg-transparent">
                <TableHead className="pl-6">Investor</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Equity Capital</TableHead>
                <TableHead className="text-right">Equity %</TableHead>
                <TableHead className="text-right">ROI</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {investors.map((inv: any) => {
                const netEquity = parseFloat(inv.total_capital);
                const equityPct = totalFundEquity > 0 ? (netEquity / totalFundEquity) * 100 : 0;
                const profitShare = totalFundEquity > 0 ? (netEquity / totalFundEquity) * totalUnrealized : 0;
                const accrued = accruedMap.get(inv.id) || 0;
                const totalProfit = profitShare + accrued;
                // ROI = total profit / gross capital ever invested (deposits + bonuses, never reduced by withdrawals)
                const grossEquity = grossCapitalMap.get(inv.id)?.invested ?? netEquity;
                const roi = grossEquity > 0 ? (totalProfit / grossEquity) * 100 : 0;

                return (
                  <TableRow key={inv.id} className="group hover:bg-muted/20 transition-colors border-border/30">
                    <TableCell className="pl-6">
                      <Link href={`/investors/${inv.id}`} className="flex items-center gap-3 w-fit">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm flex-shrink-0">
                          {inv.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-semibold text-sm hover:text-primary transition-colors flex items-center gap-1">
                          {inv.name}
                          <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{inv.joined}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-sm">
                      {fmt(netEquity)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="outline"
                        className="text-[10px] h-5 px-1.5 text-violet-400 border-violet-400/30 bg-violet-400/5"
                      >
                        {equityPct.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="outline"
                        className={`text-[10px] h-5 px-1.5 ${
                          roi >= 0
                            ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/5"
                            : "text-red-400 border-red-400/30 bg-red-400/5"
                        }`}
                      >
                        {roi >= 0 ? "+" : ""}{roi.toFixed(2)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex justify-end gap-2">
                        <EditNameDialog id={inv.id} currentName={inv.name} title="Edit Investor Name" updateAction={updateInvestorName} />
                        <DeleteButton id={inv.id} deleteAction={deleteInvestor} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {investors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-16 text-sm">
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
