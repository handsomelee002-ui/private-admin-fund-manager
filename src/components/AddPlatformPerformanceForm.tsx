"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { upsertPlatformPerformance } from "@/actions/trading";

export function AddPlatformPerformanceForm({ platformId }: { platformId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    formData.append("platform_id", platformId);
    const res = await upsertPlatformPerformance(formData);
    setLoading(false);
    if (res?.success) {
      setOpen(false);
    } else {
      alert(res?.error || "An error occurred");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 px-4 py-2 items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 gap-2">
        <Plus className="h-4 w-4" />
        Update Performance
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Update Monthly Performance</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="month">Month</Label>
            <Input id="month" name="month" type="month" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unrealized_profit">Unrealized Profit (RM)</Label>
            <Input id="unrealized_profit" name="unrealized_profit" type="number" step="0.01" required placeholder="e.g. 1500.50 or -500.00" />
            <p className="text-xs text-muted-foreground mt-1">This will overwrite the entry if it already exists for this month.</p>
          </div>
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Performance"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
