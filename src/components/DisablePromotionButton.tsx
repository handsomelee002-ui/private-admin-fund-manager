"use client";

import { useState } from "react";
import { disableFixedSavingsPromotion } from "@/actions/fixedSavingsRates";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";

export function DisablePromotionButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (!confirm("Disable this promotion?")) return;
    setLoading(true);
    const result = await disableFixedSavingsPromotion(id);
    setLoading(false);
    if (result?.error) alert(result.error);
  }

  return (
    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={handleClick} disabled={loading}>
      <Ban className="h-4 w-4" />
      <span className="sr-only">Disable promotion</span>
    </Button>
  );
}
