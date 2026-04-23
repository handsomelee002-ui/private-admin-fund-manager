import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function InvestorsPage() {
  const investors = [
    { id: "INV-001", name: "Lee Che Hou", joined: "2024-01-15", totalCapital: "RM 500,000" },
    { id: "INV-002", name: "Ng Siew Chin", joined: "2024-02-20", totalCapital: "RM 605,000" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Investors</h1>
          <p className="text-muted-foreground mt-2">
            Manage your fund investors and view their total capital.
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Add Investor
        </Button>
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader>
          <CardTitle>Directory</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Joined Date</TableHead>
                <TableHead className="text-right">Total Capital</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {investors.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium text-primary">{inv.id}</TableCell>
                  <TableCell>{inv.name}</TableCell>
                  <TableCell>{inv.joined}</TableCell>
                  <TableCell className="text-right font-semibold">{inv.totalCapital}</TableCell>
                </TableRow>
              ))}
              {investors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No investors found.
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
