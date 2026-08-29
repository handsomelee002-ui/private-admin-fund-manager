import { Navbar } from "@/components/Navbar";
import { Sidebar } from "@/components/Sidebar";
import { requireSession } from "@/lib/auth";
import { RoleProvider } from "@/components/RoleContext";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { role } = await requireSession();

  return (
    <RoleProvider role={role}>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
          <Navbar role={role} />
          <div className="flex-1 overflow-y-auto p-4 md:p-8">{children}</div>
        </main>
      </div>
    </RoleProvider>
  );
}
