import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DevelopmentDataTools } from "@/components/DevelopmentDataTools";
import { Database } from "lucide-react";

export const dynamic = "force-dynamic";

export default function DevelopmentPage() {
  const enabled = process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_DATA_TOOLS === "true";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Development</h1>
        <p className="text-muted-foreground mt-1 text-sm">Seed and wipe tools for the fresh weekly NAV data model.</p>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Data Tools</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!enabled && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              Development data tools are disabled in production unless ALLOW_DEV_DATA_TOOLS=true.
            </div>
          )}
          <DevelopmentDataTools />
        </CardContent>
      </Card>
    </div>
  );
}
