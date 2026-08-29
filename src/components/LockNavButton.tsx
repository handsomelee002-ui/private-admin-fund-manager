"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteDraftNavWeekAction, lockNavWeekAction } from "@/actions/fund";
import { Button } from "@/components/ui/button";
import { Lock, Trash2 } from "lucide-react";
import { useIsViewer } from "@/components/RoleContext";

export function LockNavButton({ id }: { id: string }) {
  const router = useRouter();
  const [locking, setLocking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function lock() {
    if (!confirm("Lock this NAV week? Locked NAV weeks are immutable and cannot be deleted.")) return;
    const formData = new FormData();
    formData.set("id", id);
    setLocking(true);
    const result = await lockNavWeekAction(formData);
    setLocking(false);
    if (result?.error) {
      alert(result.error);
      return;
    }
    // The action revalidates on the server, but this is called straight from a
    // click rather than through a form, so the mounted tree keeps rendering the
    // pre-lock payload until the router is told to refetch it.
    router.refresh();
  }

  async function deleteDraft() {
    if (!confirm("Delete this draft NAV week? Platform snapshots for this draft will also be removed.")) return;
    const formData = new FormData();
    formData.set("id", id);
    setDeleting(true);
    const result = await deleteDraftNavWeekAction(formData);
    setDeleting(false);
    if (result?.error) {
      alert(result.error);
      return;
    }
    router.refresh();
  }

  const viewerLocked = useIsViewer();
  if (viewerLocked) return null;

  return (
    <div className="flex justify-end gap-2">
      <Button type="button" size="sm" variant="outline" onClick={lock} disabled={locking || deleting} className="gap-2">
        <Lock className="h-3.5 w-3.5" />
        {locking ? "Locking..." : "Lock"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={deleteDraft} disabled={locking || deleting} className="gap-2 text-destructive hover:text-destructive">
        <Trash2 className="h-3.5 w-3.5" />
        {deleting ? "Deleting..." : "Delete Draft"}
      </Button>
    </div>
  );
}
