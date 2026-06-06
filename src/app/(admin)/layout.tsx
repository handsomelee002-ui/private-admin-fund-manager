import { Navbar } from "@/components/Navbar";
import { Sidebar } from "@/components/Sidebar";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 overflow-y-auto p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
