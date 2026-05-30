import Link from "next/link";
import { PortalAccessEntryForm } from "@/components/PortalAccessEntryForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PortalLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Investor statement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <PortalAccessEntryForm />
          <p className="text-center text-sm text-muted-foreground">
            Administrator? <Link className="text-primary hover:underline" href="/admin/login" prefetch={false}>Sign in</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
