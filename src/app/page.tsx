import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, TrendingUp, Users, DollarSign } from "lucide-react";

export default function Dashboard() {
  // TODO: Fetch real data from Supabase
  const stats = [
    {
      title: "Total Fund Value",
      value: "RM 1,250,000",
      icon: DollarSign,
      trend: "+12.5% from last month",
    },
    {
      title: "Realized Profit YTD",
      value: "RM 145,000",
      icon: TrendingUp,
      trend: "+4.2% from last month",
    },
    {
      title: "Total Investor Capital",
      value: "RM 1,105,000",
      icon: Users,
      trend: "3 active investors",
    },
    {
      title: "Dry Powder (Cash)",
      value: "RM 320,000",
      icon: Wallet,
      trend: "Across 2 accounts",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Overview of your private fund performance and liquidity.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm transition-all hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stat.trend}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Placeholder for charts or recent activity */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader>
            <CardTitle>Performance Overview</CardTitle>
          </CardHeader>
          <CardContent className="pl-2 flex justify-center items-center h-[300px] text-muted-foreground">
            Chart will be displayed here
          </CardContent>
        </Card>
        <Card className="col-span-3 bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center items-center h-[300px] text-muted-foreground">
            List of recent trades/deposits
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
