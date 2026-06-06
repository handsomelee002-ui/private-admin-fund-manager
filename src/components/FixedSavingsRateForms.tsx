"use client";

import { useState } from "react";
import { addFixedSavingsBaseRate, addFixedSavingsPromotion } from "@/actions/fixedSavingsRates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CalendarPlus, Percent } from "lucide-react";

export function AddBaseRateForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setLoading(true);
    const result = await addFixedSavingsBaseRate(formData);
    setLoading(false);
    if ("success" in result && result.success) setOpen(false);
    else alert(result?.error || "Failed to save base rate.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90">
        <Percent className="h-4 w-4" />
        Base Rate
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Base Rate</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="base_effective_date">Effective Date</Label>
              <Input id="base_effective_date" name="effective_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="base_annual_rate_percent">Nominal p.a. %</Label>
              <Input id="base_annual_rate_percent" name="annual_rate_percent" type="number" step="0.0001" min="0" max="100" required />
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

export function AddPromotionForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setLoading(true);
    const result = await addFixedSavingsPromotion(formData);
    setLoading(false);
    if ("success" in result && result.success) setOpen(false);
    else alert(result?.error || "Failed to add promotion.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90">
        <CalendarPlus className="h-4 w-4" />
        Promotion
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Add Promotion</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="promo_name">Name</Label>
            <Input id="promo_name" name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="promo_start_date">Start Date</Label>
              <Input id="promo_start_date" name="start_date" type="date" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo_end_date">End Date</Label>
              <Input id="promo_end_date" name="end_date" type="date" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="promo_annual_rate_percent">Nominal p.a. %</Label>
              <Input id="promo_annual_rate_percent" name="annual_rate_percent" type="number" step="0.0001" min="0" max="100" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo_balance_cap">Balance Cap</Label>
              <Input id="promo_balance_cap" name="balance_cap" type="number" step="0.01" min="0.01" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="promo_notes">Notes</Label>
            <Input id="promo_notes" name="notes" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
