"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addTrade } from "@/actions/trading";

export function AddTradeForm({ defaultTicker, defaultPositionId }: { defaultTicker?: string, defaultPositionId?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<string>("Buy");
  const [platform, setPlatform] = useState<string>("MT5");

  async function handleSubmit(formData: FormData) {
    formData.append("type", type);
    formData.append("platform", platform);
    if (defaultTicker) formData.append("ticker", defaultTicker);
    if (defaultPositionId) formData.append("position_id", defaultPositionId);
    
    setLoading(true);
    const res = await addTrade(formData);
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
        Add Trade
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Trade Record</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">{type === "Buy" ? "Date Open" : "Date Closed"}</Label>
              <Input id="date" name="date" type="date" required defaultValue={new Date().toISOString().split('T')[0]} />
            </div>
            <div className="space-y-2">
              <Label>Platform</Label>
              <Select value={platform} onValueChange={(val) => setPlatform(val || "MT5")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MT5">MT5</SelectItem>
                  <SelectItem value="Moomoo">Moomoo</SelectItem>
                  <SelectItem value="Wise">Wise</SelectItem>
                  <SelectItem value="Binance">Binance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ticker">Ticker/Asset</Label>
              <Input id="ticker" name="ticker" required placeholder="e.g., AAPL" defaultValue={defaultTicker || ""} disabled={!!defaultTicker} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(val) => setType(val || "Buy")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Buy">Buy</SelectItem>
                  <SelectItem value="Sell">Sell</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" name="currency" required placeholder="USD" defaultValue="USD" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Price</Label>
              <Input id="price" name="price" type="number" step="0.0001" min="0" required placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input id="quantity" name="quantity" type="number" step="0.0001" required placeholder="e.g., 10" />
            </div>
          </div> 
          
          <div className="grid grid-cols-2 gap-4 pt-2">
            {type === "Buy" ? (
              <div className="space-y-2">
                <Label htmlFor="amount_rm">Total Amount (RM Equivalent)</Label>
                <Input id="amount_rm" name="amount_rm" type="number" step="0.01" required placeholder="e.g., 4500.00" />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="profit_loss">Realized Profit/Loss (RM)</Label>
                <Input id="profit_loss" name="profit_loss" type="number" step="0.01" required placeholder="Use negative for loss" />
              </div>
            )}
          </div>

          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Trade"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
