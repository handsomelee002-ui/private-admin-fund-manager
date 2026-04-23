"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addCapitalRecord } from "@/actions/capital";

export function AddCapitalForm({ investors, defaultInvestorId }: { investors: any[], defaultInvestorId?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [investorId, setInvestorId] = useState<string>(defaultInvestorId || "");
  const [type, setType] = useState<string>("Deposit");

  async function handleSubmit(formData: FormData) {
    if (!investorId) {
      alert("Please select an investor");
      return;
    }
    formData.append("investor_id", investorId);
    formData.append("type", type);
    
    setLoading(true);
    const res = await addCapitalRecord(formData);
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
        Add Record
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Capital Record</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Investor</Label>
            <Select value={investorId} onValueChange={(val) => setInvestorId(val || "")} disabled={!!defaultInvestorId}>
              <SelectTrigger>
                <SelectValue placeholder="Select investor">
                  {investorId ? investors.find(i => i.id === investorId)?.name : "Select investor"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {investors.map((inv) => (
                  <SelectItem key={inv.id} value={inv.id}>{inv.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(val) => setType(val || "Deposit")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Deposit">Deposit</SelectItem>
                  <SelectItem value="Withdrawal">Withdrawal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" required defaultValue={new Date().toISOString().split('T')[0]} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (RM)</Label>
            <Input id="amount" name="amount" type="number" step="0.01" min="0" required placeholder="0.00" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Input id="notes" name="notes" placeholder="e.g., Monthly contribution" />
          </div>
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Record"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
