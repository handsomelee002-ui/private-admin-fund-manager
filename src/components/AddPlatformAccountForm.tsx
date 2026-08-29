"use client";

import { useState } from "react";
import { addPlatformAccount } from "@/actions/trading";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { useIsViewer } from "@/components/RoleContext";

export function AddPlatformAccountForm({ platformId }: { platformId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const formData = new FormData(event.currentTarget);
    formData.append("platform_id", platformId);
    const result = await addPlatformAccount(formData);
    setLoading(false);
    if (result?.success) setOpen(false);
    else alert(result?.error || "Failed to add account.");
  }

  const viewerLocked = useIsViewer();
  if (viewerLocked) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 px-3 py-2 items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent gap-2">
        <Plus className="h-4 w-4" />
        Account
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Account</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="name">Account Name</Label>
            <Input id="name" name="name" required placeholder="Wise USD, IBKR USD Cash" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="account_type">Type</Label>
              <select id="account_type" name="account_type" className="h-9 w-full rounded-md border border-input bg-card/50 px-3 text-sm">
                <option value="BANK">Bank</option>
                <option value="WALLET">Wallet</option>
                <option value="BROKER_CASH">Broker Cash</option>
                <option value="BROKER_PORTFOLIO">Broker Portfolio</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" name="currency" required maxLength={10} placeholder="USD" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
