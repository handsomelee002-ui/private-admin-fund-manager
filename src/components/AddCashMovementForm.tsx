"use client";

import { useState } from "react";
import { recordCashMovementAction } from "@/actions/fund";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";

export function AddCashMovementForm({
  investors,
  defaultInvestorId,
}: {
  investors: any[];
  defaultInvestorId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [investorId, setInvestorId] = useState(defaultInvestorId || "");
  const [type, setType] = useState("Deposit");
  const [withdrawAll, setWithdrawAll] = useState(false);
  const selectedInvestor = investors.find((investor) => investor.id === investorId);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("investor_id", investorId);
    formData.set("type", type);
    formData.set("withdraw_all", withdrawAll ? "true" : "false");
    setLoading(true);
    const result = await recordCashMovementAction(formData);
    setLoading(false);
    if (result?.success) setOpen(false);
    else alert(result?.error || "Failed to record cash movement.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 px-4 py-2 items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 gap-2">
        <Plus className="h-4 w-4" />
        Cash Movement
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Deposit or Withdrawal</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Investor</Label>
            {defaultInvestorId ? (
              <Input value={selectedInvestor?.name || "Selected investor"} readOnly />
            ) : (
              <Select value={investorId} onValueChange={(value) => setInvestorId(value || "")}>
                <SelectTrigger><SelectValue placeholder="Select investor" /></SelectTrigger>
                <SelectContent>
                  {investors.map((investor) => (
                    <SelectItem key={investor.id} value={investor.id}>{investor.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(value) => { setType(value || "Deposit"); setWithdrawAll(false); }}>
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
          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required={!withdrawAll} disabled={withdrawAll} />
          </div>
          {type === "Withdrawal" && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={withdrawAll}
                onChange={(event) => setWithdrawAll(event.target.checked)}
              />
              Withdraw all units at latest locked NAV
            </label>
          )}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={loading || !investorId}>
              {loading ? "Saving..." : "Record"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
