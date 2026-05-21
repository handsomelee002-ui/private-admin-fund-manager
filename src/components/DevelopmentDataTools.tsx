"use client";

import { useState } from "react";
import { cleanAllDataAction, dropAllTablesAction, importDummyDataAction, initializeDatabaseAction } from "@/actions/development";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Database, Trash2 } from "lucide-react";

export function DevelopmentDataTools() {
  const [initPhrase, setInitPhrase] = useState("");
  const [seedPhrase, setSeedPhrase] = useState("");
  const [cleanPhrase, setCleanPhrase] = useState("");
  const [dropPhrase, setDropPhrase] = useState("");
  const [loading, setLoading] = useState<"clean" | "drop" | "init" | "seed" | null>(null);

  async function runInitialize() {
    const formData = new FormData();
    formData.set("confirmation", initPhrase);
    setLoading("init");
    const result = await initializeDatabaseAction(formData);
    setLoading(null);
    if (result?.error) alert(result.error);
  }

  async function runSeed() {
    const formData = new FormData();
    formData.set("confirmation", seedPhrase);
    setLoading("seed");
    const result = await importDummyDataAction(formData);
    setLoading(null);
    if (result?.error) alert(result.error);
  }

  async function runDrop() {
    const formData = new FormData();
    formData.set("confirmation", dropPhrase);
    setLoading("drop");
    const result = await dropAllTablesAction(formData);
    setLoading(null);
    if (result?.error) alert(result.error);
  }

  async function runClean() {
    const formData = new FormData();
    formData.set("confirmation", cleanPhrase);
    setLoading("clean");
    const result = await cleanAllDataAction(formData);
    setLoading(null);
    if (result?.error) alert(result.error);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-4">
      <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-red-400">
          <Trash2 className="h-4 w-4" />
          Delete Records
        </div>
        <Input value={cleanPhrase} onChange={(event) => setCleanPhrase(event.target.value)} placeholder="DELETE ALL FUND DATA" />
        <Button variant="destructive" onClick={runClean} disabled={loading !== null} className="gap-2">
          <Trash2 className="h-4 w-4" />
          {loading === "clean" ? "Deleting..." : "Delete Records"}
        </Button>
      </div>
      <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-red-400">
          <Trash2 className="h-4 w-4" />
          Drop All Tables
        </div>
        <Input value={dropPhrase} onChange={(event) => setDropPhrase(event.target.value)} placeholder="DROP ALL FUND TABLES" />
        <Button variant="destructive" onClick={runDrop} disabled={loading !== null} className="gap-2">
          <Trash2 className="h-4 w-4" />
          {loading === "drop" ? "Dropping..." : "Drop All Tables"}
        </Button>
      </div>
      <div className="rounded-md border border-border/60 bg-card/50 p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <Database className="h-4 w-4 text-primary" />
          Initialize Database
        </div>
        <Input value={initPhrase} onChange={(event) => setInitPhrase(event.target.value)} placeholder="INITIALIZE DATABASE" />
        <Button onClick={runInitialize} disabled={loading !== null} className="gap-2">
          <Database className="h-4 w-4" />
          {loading === "init" ? "Initializing..." : "Initialize Database"}
        </Button>
      </div>
      <div className="rounded-md border border-border/60 bg-card/50 p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <Database className="h-4 w-4 text-primary" />
          Import Dummy Data
        </div>
        <Input value={seedPhrase} onChange={(event) => setSeedPhrase(event.target.value)} placeholder="IMPORT DUMMY DATA" />
        <Button onClick={runSeed} disabled={loading !== null} className="gap-2">
          <Database className="h-4 w-4" />
          {loading === "seed" ? "Importing..." : "Import Dummy Data"}
        </Button>
      </div>
    </div>
  );
}
