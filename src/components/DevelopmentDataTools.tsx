"use client";

import { useState } from "react";
import { cleanAllDataAction, dropAllTablesAction, importDummyDataAction, initializeDatabaseAction } from "@/actions/development";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Database, RefreshCcw, ShieldAlert, Trash2 } from "lucide-react";

type DevelopmentDataToolsProps = {
  adminPassword: string;
  onProtectedActionSuccess: () => void;
};

export function DevelopmentDataTools({ adminPassword, onProtectedActionSuccess }: DevelopmentDataToolsProps) {
  const [initPhrase, setInitPhrase] = useState("");
  const [seedPhrase, setSeedPhrase] = useState("");
  const [cleanPhrase, setCleanPhrase] = useState("");
  const [dropPhrase, setDropPhrase] = useState("");
  const [loading, setLoading] = useState<"clean" | "drop" | "init" | "seed" | null>(null);

  function withAdminPassword(formData: FormData) {
    formData.set("admin_password", adminPassword);
    return formData;
  }

  async function runInitialize() {
    const formData = withAdminPassword(new FormData());
    formData.set("confirmation", initPhrase);
    setLoading("init");
    const result = await initializeDatabaseAction(formData);
    setLoading(null);
    setInitPhrase("");
    if (result?.error) {
      alert(result.error);
      return;
    }
    alert("Database initialized.");
    onProtectedActionSuccess();
  }

  async function runSeed() {
    const formData = withAdminPassword(new FormData());
    formData.set("confirmation", seedPhrase);
    setLoading("seed");
    const result = await importDummyDataAction(formData);
    setLoading(null);
    setSeedPhrase("");
    if (result?.error) {
      alert(result.error);
      return;
    }
    alert("Dummy data imported.");
    onProtectedActionSuccess();
  }

  async function runDrop() {
    const formData = withAdminPassword(new FormData());
    formData.set("confirmation", dropPhrase);
    setLoading("drop");
    const result = await dropAllTablesAction(formData);
    setLoading(null);
    setDropPhrase("");
    if (result?.error) {
      alert(result.error);
      return;
    }
    alert("Fund tables dropped.");
    onProtectedActionSuccess();
  }

  async function runClean() {
    const formData = withAdminPassword(new FormData());
    formData.set("confirmation", cleanPhrase);
    setLoading("clean");
    const result = await cleanAllDataAction(formData);
    setLoading(null);
    setCleanPhrase("");
    if (result?.error) {
      alert(result.error);
      return;
    }
    alert("Fund records deleted.");
    onProtectedActionSuccess();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-4">
      <div className="flex min-h-[18rem] flex-col rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <div className="flex min-h-24 items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold text-red-400">
              <Trash2 className="h-4 w-4" />
              Delete Records
            </div>
            <p className="text-xs text-muted-foreground">
              Clear investors, NAV, ledgers, platforms, claims, bonuses, and audit records while keeping table structure.
            </p>
          </div>
          <Badge variant="destructive">Danger</Badge>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="clean_confirmation">Confirmation</Label>
          <Input id="clean_confirmation" value={cleanPhrase} onChange={(event) => setCleanPhrase(event.target.value)} placeholder="DELETE ALL FUND DATA" />
        </div>
        <Button variant="destructive" onClick={runClean} disabled={loading !== null} className="mt-4 w-fit gap-2">
          <Trash2 className="h-4 w-4" />
          {loading === "clean" ? "Deleting..." : "Delete Records"}
        </Button>
      </div>
      <div className="flex min-h-[18rem] flex-col rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <div className="flex min-h-24 items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold text-red-400">
              <AlertTriangle className="h-4 w-4" />
              Drop All Tables
            </div>
            <p className="text-xs text-muted-foreground">
              Remove all managed fund tables, including backup-managed audit and cash balance tables.
            </p>
          </div>
          <Badge variant="destructive">Critical</Badge>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="drop_confirmation">Confirmation</Label>
          <Input id="drop_confirmation" value={dropPhrase} onChange={(event) => setDropPhrase(event.target.value)} placeholder="DROP ALL FUND TABLES" />
        </div>
        <Button variant="destructive" onClick={runDrop} disabled={loading !== null} className="mt-4 w-fit gap-2">
          <Trash2 className="h-4 w-4" />
          {loading === "drop" ? "Dropping..." : "Drop All Tables"}
        </Button>
      </div>
      <div className="flex min-h-[18rem] flex-col rounded-lg border border-border/60 bg-card/50 p-4">
        <div className="flex min-h-24 items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold">
              <Database className="h-4 w-4 text-primary" />
              Initialize Database
            </div>
            <p className="text-xs text-muted-foreground">
              Create or repair required tables, constraints, indexes, audit columns, and default fund configuration.
            </p>
          </div>
          <Badge variant="outline">Setup</Badge>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="init_confirmation">Confirmation</Label>
          <Input id="init_confirmation" value={initPhrase} onChange={(event) => setInitPhrase(event.target.value)} placeholder="INITIALIZE DATABASE" />
        </div>
        <Button onClick={runInitialize} disabled={loading !== null} className="mt-4 w-fit gap-2">
          <Database className="h-4 w-4" />
          {loading === "init" ? "Initializing..." : "Initialize Database"}
        </Button>
      </div>
      <div className="flex min-h-[18rem] flex-col rounded-lg border border-border/60 bg-card/50 p-4">
        <div className="flex min-h-24 items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold">
              <RefreshCcw className="h-4 w-4 text-primary" />
              Import Dummy Data
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="block">Rebuild demo investors,</span>
              <span className="block">NAV weeks, platforms,</span>
              <span className="block">2024-now transactions,</span>
              <span className="block">claims, fees, trades,</span>
              <span className="block">and audit records.</span>
            </p>
          </div>
          <Badge variant="outline" className="gap-1">
            <ShieldAlert className="h-3 w-3" />
            Dev
          </Badge>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="seed_confirmation">Confirmation</Label>
          <Input id="seed_confirmation" value={seedPhrase} onChange={(event) => setSeedPhrase(event.target.value)} placeholder="IMPORT DUMMY DATA" />
        </div>
        <Button onClick={runSeed} disabled={loading !== null} className="mt-4 w-fit gap-2">
          <Database className="h-4 w-4" />
          {loading === "seed" ? "Importing..." : "Import Dummy Data"}
        </Button>
      </div>
      </div>
    </div>
  );
}
