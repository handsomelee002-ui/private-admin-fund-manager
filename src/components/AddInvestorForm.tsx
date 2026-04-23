"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { addInvestor } from "@/actions/investors";

export function AddInvestorForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    const res = await addInvestor(formData);
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
        Add Investor
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Investor</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full Name</Label>
            <Input id="name" name="name" required placeholder="e.g., Lee Che Hou" />
          </div>
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Investor"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
