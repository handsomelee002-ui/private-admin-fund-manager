import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileSpreadsheet } from "lucide-react";

export default function StatementPage() {
  // Production-ready mock structure matching the accountStatement.xlsx format
  const statements = [
    {
      year: 2025,
      month: "March",
      profitOrLoss: "PROFIT",
      totalBrokerageReturn: 44.67,
      totalNewBalance: 4282.67,
      rows: [
        { name: "Loo Lay Heong", netDeposit: 750, balanceCD_prev: 0, depositWithdraw: 0, balanceBD: 0, roi: 1.08, after: 1.08, amount: 1.08 },
        { name: "Lee Che Hou", netDeposit: 200, balanceCD_prev: 0, depositWithdraw: 0, balanceBD: 0, roi: 0.28, after: 0.28, amount: 0.28 },
        { name: "Lee Che Jie", netDeposit: 100, balanceCD_prev: 0, depositWithdraw: 0, balanceBD: 0, roi: 0.14, after: 0.14, amount: 0.14 },
        { name: "Lee Che Loon", netDeposit: 28000, balanceCD_prev: 0, depositWithdraw: 1888, balanceBD: 1888, roi: 40.54, after: 1928.54, amount: 1928.54 },
        { name: "Lee Che Siang", netDeposit: 1800, balanceCD_prev: 0, depositWithdraw: 0, balanceBD: 0, roi: 2.60, after: 2.60, amount: 2.60 },
        { name: "dailyCompound", netDeposit: 0, balanceCD_prev: 0, depositWithdraw: 2350, balanceBD: 2350, roi: 0, after: 2350, amount: 2350 },
      ],
      totals: { netDeposit: 30850, balanceCD_prev: 0, depositWithdraw: 4238, balanceBD: 4238, roi: 44.67, after: 4282.67, amount: 4282.67 }
    },
    {
      year: 2025,
      month: "May",
      profitOrLoss: "LOSS",
      totalBrokerageReturn: -157.12,
      totalNewBalance: 10375.55,
      rows: [
        { name: "Loo Lay Heong", netDeposit: 750, balanceCD_prev: 1.08, depositWithdraw: 0, balanceBD: 1.08, roi: -3.35, after: -2.27, amount: -2.27 },
        { name: "Lee Che Hou", netDeposit: 200, balanceCD_prev: 0.28, depositWithdraw: 0, balanceBD: 0.28, roi: -0.89, after: -0.60, amount: -0.60 },
        { name: "Lee Che Jie", netDeposit: 100, balanceCD_prev: 0.14, depositWithdraw: 0, balanceBD: 0.14, roi: -0.44, after: -0.30, amount: -0.30 },
        { name: "Lee Che Loon", netDeposit: 29888, balanceCD_prev: 1928.54, depositWithdraw: 350, balanceBD: 2278.54, roi: -133.83, after: 2144.70, amount: 2144.70 },
        { name: "Lee Che Siang", netDeposit: 1800, balanceCD_prev: 2.60, depositWithdraw: 0, balanceBD: 2.60, roi: -8.06, after: -5.45, amount: -5.45 },
        { name: "dailyCompound", netDeposit: 2350, balanceCD_prev: 2350.00, depositWithdraw: 5900, balanceBD: 8250.00, roi: -10.52, after: 8239.47, amount: 8239.47 },
      ],
      totals: { netDeposit: 35088, balanceCD_prev: 4282.67, depositWithdraw: 6250, balanceBD: 10532.67, roi: -157.12, after: 10375.55, amount: 10375.55 }
    }
  ];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Account Statements</h1>
          <p className="text-muted-foreground mt-2">
            Monthly fund performance and investor balances.
          </p>
        </div>
      </div>

      {statements.map((statement, idx) => (
        <Card key={idx} className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden mb-8">
          <CardHeader className="bg-muted/30 border-b border-border/50">
            <div className="flex justify-between items-center">
              <CardTitle className="text-xl flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                {statement.month} {statement.year}
              </CardTitle>
              <div className="flex gap-4 text-sm font-semibold">
                <span className={statement.profitOrLoss === "PROFIT" ? "text-green-500" : "text-destructive"}>
                  Overall: {statement.profitOrLoss} ({statement.totalBrokerageReturn})
                </span>
                <span>Final Balance: {statement.totalNewBalance}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/10 whitespace-nowrap">
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Net Deposit</TableHead>
                  <TableHead className="text-right">Balance C/D</TableHead>
                  <TableHead className="text-right">Deposit/Withdraw</TableHead>
                  <TableHead className="text-right">Balance B/D</TableHead>
                  <TableHead className="text-right">Return In Investment</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead className="text-right">Amount (Bal C/D)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.rows.map((row, i) => (
                  <TableRow key={i} className="whitespace-nowrap">
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right">{row.netDeposit.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{row.balanceCD_prev.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{row.depositWithdraw.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{row.balanceBD.toFixed(2)}</TableCell>
                    <TableCell className={`text-right font-medium ${row.roi >= 0 ? "text-green-500" : "text-destructive"}`}>
                      {row.roi.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">{row.after.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-bold text-primary">{row.amount.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {/* Totals Row */}
                <TableRow className="bg-muted/20 font-bold whitespace-nowrap">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right">{statement.totals.netDeposit.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{statement.totals.balanceCD_prev.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{statement.totals.depositWithdraw.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{statement.totals.balanceBD.toFixed(2)}</TableCell>
                  <TableCell className={`text-right ${statement.totals.roi >= 0 ? "text-green-500" : "text-destructive"}`}>
                    {statement.totals.roi.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">{statement.totals.after.toFixed(2)}</TableCell>
                  <TableCell className="text-right text-primary">{statement.totals.amount.toFixed(2)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
