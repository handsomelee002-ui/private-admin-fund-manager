"use client";

import { useRef, useState } from "react";
import { recordFixedSavingsAction } from "@/actions/fund";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { InvestorSelect, investorDisplayName, type InvestorOption } from "@/components/InvestorSelect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";

export function AddFixedSavingsMovementForm({
  investors,
  defaultInvestorId,
}: {
  investors: InvestorOption[];
  defaultInvestorId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [investorId, setInvestorId] = useState(defaultInvestorId || "");
  const [type, setType] = useState("Deposit");
  const submittingRef = useRef(false);
  const selectedInvestor = investors.find((investor) => investor.id === investorId);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    const formData = new FormData(event.currentTarget);
    formData.set("investor_id", investorId);
    formData.set("type", type);
    setLoading(true);
    const result = await recordFixedSavingsAction(formData);
    setLoading(false);
    submittingRef.current = false;
    if ("success" in result && result.success) setOpen(false);
    else alert(result?.error || "Failed to record fixed savings.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 px-4 py-2 items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 gap-2">
        <Plus className="h-4 w-4" />
        Fixed Savings
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Fixed Savings</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Investor</Label>
            {defaultInvestorId ? (
              <Input value={investorDisplayName(selectedInvestor)} readOnly />
            ) : (
              <InvestorSelect investors={investors} value={investorId} onValueChange={setInvestorId} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(value) => setType(value || "Deposit")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Deposit">Deposit</SelectItem>
                  <SelectItem value="Withdrawal">Withdrawal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="annual_rate_percent">Annual Rate %</Label>
              <Input id="annual_rate_percent" name="annual_rate_percent" type="number" step="0.0001" min="0.0001" required={type === "Deposit"} disabled={type !== "Deposit"} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={loading || !investorId} aria-busy={loading}>{loading ? "Saving..." : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
