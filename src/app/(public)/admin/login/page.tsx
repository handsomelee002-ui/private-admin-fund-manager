import Link from "next/link";
import { AdminLoginForm } from "@/components/AdminLoginForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Administrator sign in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <AdminLoginForm />
          <p className="text-center text-sm text-muted-foreground">
            Investor statement access? <Link className="text-primary hover:underline" href="/login" prefetch={false}>Open portal</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
