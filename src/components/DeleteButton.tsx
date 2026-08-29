"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { useIsViewer } from "@/components/RoleContext";

export function DeleteButton({ id, deleteAction }: { id: string, deleteAction: (id: string) => Promise<{success?: boolean, error?: string}> }) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this record?")) return;
    
    setLoading(true);
    const res = await deleteAction(id);
    setLoading(false);
    
    if (res?.error) {
      alert(res.error);
    }
  }

  const viewerLocked = useIsViewer();
  if (viewerLocked) return null;

  return (
    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={handleDelete} disabled={loading}>
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
