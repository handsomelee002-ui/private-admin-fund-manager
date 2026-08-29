"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { BackupManager } from "@/components/BackupManager";
import { DevelopmentDataTools } from "@/components/DevelopmentDataTools";
import { useIsViewer } from "@/components/RoleContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsProtectedTools() {
  const isViewer = useIsViewer();
  const [adminPassword, setAdminPassword] = useState("");

  if (isViewer) {
    return (
      <p className="text-sm text-muted-foreground">
        Backup and data tools require an administrator account.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border/60 bg-background/60 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Protected action password</p>
            </div>
          </div>
          <div className="w-full space-y-1.5 lg:max-w-sm">
            <Label htmlFor="settings_admin_password">Admin login password</Label>
            <Input
              id="settings_admin_password"
              type="password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>
        </div>
      </div>

      <BackupManager adminPassword={adminPassword} onProtectedActionSuccess={() => setAdminPassword("")} />
      <DevelopmentDataTools adminPassword={adminPassword} onProtectedActionSuccess={() => setAdminPassword("")} />
    </div>
  );
}
