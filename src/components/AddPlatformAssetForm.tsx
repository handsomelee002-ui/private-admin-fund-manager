"use client";

import { useState } from "react";
import { addPlatformAsset } from "@/actions/trading";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { useIsViewer } from "@/components/RoleContext";

export function AddPlatformAssetForm({ platformId }: { platformId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const formData = new FormData(event.currentTarget);
    formData.append("platform_id", platformId);
    const result = await addPlatformAsset(formData);
    setLoading(false);
    if (result?.success) setOpen(false);
    else alert(result?.error || "Failed to add asset.");
  }

  const viewerLocked = useIsViewer();
  if (viewerLocked) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 px-3 py-2 items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent gap-2">
        <Plus className="h-4 w-4" />
        Asset
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Add Asset</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="symbol">Symbol</Label>
              <Input id="symbol" name="symbol" required placeholder="VOO" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" name="currency" required placeholder="USD" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" placeholder="Vanguard S&P 500 ETF" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="asset_type">Type</Label>
              <Input id="asset_type" name="asset_type" defaultValue="SECURITY" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="latest_price">Latest Price</Label>
              <Input id="latest_price" name="latest_price" type="number" step="0.0001" defaultValue="0" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="latest_fx_rate_to_myr">FX To MYR</Label>
              <Input id="latest_fx_rate_to_myr" name="latest_fx_rate_to_myr" type="number" step="0.000001" required placeholder="4.70" />
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
