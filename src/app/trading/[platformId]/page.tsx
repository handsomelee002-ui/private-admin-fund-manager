import { notFound } from "next/navigation";
import { getPlatform, getPlatformTransactions, getPlatformPerformance, deletePlatformTransaction, deletePlatformPerformance } from "@/actions/trading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddPlatformTransactionForm } from "@/components/AddPlatformTransactionForm";
import { AddPlatformPerformanceForm } from "@/components/AddPlatformPerformanceForm";
import { PlatformTransactionsChart, PlatformPerformanceChart } from "@/components/PlatformCharts";
import { DeleteButton } from "@/components/DeleteButton";
import Link from "next/link";
import { ArrowLeft, Wallet, TrendingUp, DollarSign } from "lucide-react";

export default async function PlatformDetailsPage({ params }: { params: { platformId: string } }) {
  const { platformId } = await params;
  
  const platform = await getPlatform(platformId);
  if (!platform) return notFound();

  const transactions = await getPlatformTransactions(platformId);
  const performance = await getPlatformPerformance(platformId);

  // Calculate Net Invested
  const netInvested = transactions.reduce((acc: number, t: any) => {
    return t.type === 'Deposit' ? acc + parseFloat(t.amount) : acc - parseFloat(t.amount);
  }, 0);

  // Get Latest Unrealized Profit
  const latestUnrealized = performance.length > 0 ? parseFloat(performance[0].unrealized_profit) : 0;
  
  const totalValue = netInvested + latestUnrealized;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/trading" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-6 w-6" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{platform.name}</h1>
          <p className="text-muted-foreground mt-1">Platform Details & Performance</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Invested</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">RM {netInvested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <p className="text-xs text-muted-foreground mt-1">Total Deposits - Withdrawals</p>
          </CardContent>
        </Card>
        
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Latest Unrealized</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${latestUnrealized >= 0 ? "text-blue-500" : "text-red-500"}`}>
              RM {latestUnrealized.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">From most recent entry</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              RM {totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Net Invested + Unrealized</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="transactions" className="w-full flex-col">
        <div className="grid lg:grid-cols-2 gap-6 mb-6">
          <div className="hidden lg:block"></div> {/* Empty space above chart */}
          
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <TabsList className="grid w-[250px] grid-cols-2 h-9 shrink-0">
              <TabsTrigger value="transactions" className="text-xs">Transactions</TabsTrigger>
              <TabsTrigger value="performance" className="text-xs">Performance</TabsTrigger>
            </TabsList>
            
            <div className="flex items-center w-full sm:w-auto">
              <TabsContent value="transactions" className="mt-0 w-full">
                <AddPlatformTransactionForm platformId={platformId} />
              </TabsContent>
              <TabsContent value="performance" className="mt-0 w-full">
                <AddPlatformPerformanceForm platformId={platformId} />
              </TabsContent>
            </div>
          </div>
        </div>
        
        <TabsContent value="transactions" className="mt-0">
          <div className="grid lg:grid-cols-2 gap-6 h-[500px]">
            <div className="h-full">
              <Card className="bg-card/50 backdrop-blur-sm border-border/50 h-full flex flex-col">
                <CardHeader>
                  <CardTitle className="text-lg">Capital Flows</CardTitle>
                </CardHeader>
                <CardContent className="p-0 pb-4 flex-1">
                  <PlatformTransactionsChart data={transactions} />
                </CardContent>
              </Card>
            </div>
            
            <div className="h-full">
              <Card className="bg-card/50 backdrop-blur-sm border-border/50 h-full flex flex-col">
                <CardContent className="p-0 flex-1 overflow-auto">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((t: any) => (
                        <TableRow key={t.id}>
                          <TableCell>{t.date}</TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                              t.type === 'Deposit' ? 'bg-green-500/10 text-green-500' : 'bg-orange-500/10 text-orange-500'
                            }`}>
                              {t.type}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{t.notes || "-"}</TableCell>
                          <TableCell className="text-right font-medium">
                            RM {parseFloat(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            <DeleteButton id={t.id} deleteAction={deletePlatformTransaction} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {transactions.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            No transactions recorded.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="performance" className="mt-0">
          <div className="grid lg:grid-cols-2 gap-6 h-[500px]">
            <div className="h-full">
              <Card className="bg-card/50 backdrop-blur-sm border-border/50 h-full flex flex-col">
                <CardHeader>
                  <CardTitle className="text-lg">Monthly Performance</CardTitle>
                </CardHeader>
                <CardContent className="p-0 pb-4 flex-1">
                  <PlatformPerformanceChart data={performance} />
                </CardContent>
              </Card>
            </div>
            
            <div className="h-full">
              <Card className="bg-card/50 backdrop-blur-sm border-border/50 h-full flex flex-col">
                <CardContent className="p-0 flex-1 overflow-auto">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        <TableHead>Month</TableHead>
                        <TableHead className="text-right">Unrealized Profit</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {performance.map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.month}</TableCell>
                          <TableCell className={`text-right font-medium ${parseFloat(p.unrealized_profit) >= 0 ? "text-blue-500" : "text-red-500"}`}>
                            RM {parseFloat(p.unrealized_profit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            <DeleteButton id={p.id} deleteAction={deletePlatformPerformance} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {performance.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                            No performance data recorded.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
