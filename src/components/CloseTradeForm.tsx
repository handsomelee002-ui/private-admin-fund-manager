"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Edit2 } from "lucide-react";
import { updateTrade } from "@/actions/trading";

export function CloseTradeForm({ trade }: { trade: any }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    formData.append("id", trade.id);
    
    setLoading(true);
    const res = await updateTrade(formData);
    setLoading(false);
    
    if (res?.success) {
      setOpen(false);
    } else {
      alert(res?.error || "An error occurred");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 w-8 items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground text-primary">
        <Edit2 className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit / Close Position: {trade.ticker}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="profit_loss">Realized Profit/Loss (RM)</Label>
            <Input id="profit_loss" name="profit_loss" type="number" step="0.01" defaultValue={trade.profit_loss || ""} placeholder="Use negative for loss" />
            <p className="text-xs text-muted-foreground">Clear this field to reopen the position.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="date_closed">Date Closed</Label>
            <Input id="date_closed" name="date_closed" type="date" defaultValue={trade.date_closed || new Date().toISOString().split('T')[0]} />
          </div>
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Position"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
