"use client";

import { useState } from "react";
import Link from "next/link";
import { rotateInvestorPortalAccess } from "@/actions/investors";
import { Button } from "@/components/ui/button";

export function PortalAccessControl({
  investorId,
  initialPortalAccessId,
}: {
  investorId: string;
  initialPortalAccessId?: string | null;
}) {
  const [portalAccessId, setPortalAccessId] = useState(initialPortalAccessId ?? "");
  const [loading, setLoading] = useState(false);

  async function rotate() {
    if (portalAccessId && !confirm("Rotate this investor's portal link? The existing link will stop working.")) {
      return;
    }

    setLoading(true);
    const result = await rotateInvestorPortalAccess(investorId);
    setLoading(false);
    if (result.error) {
      alert(result.error);
      return;
    }
    setPortalAccessId(result.portalAccessId ?? "");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/portal/${portalAccessId}`);
    } catch {
      alert("Unable to copy the link. Open it and copy the address from the browser.");
    }
  }

  return (
    <div className="flex justify-end gap-1">
      {portalAccessId && (
        <>
          <Button type="button" variant="outline" size="xs" onClick={copyLink}>Copy</Button>
          <Button render={<Link href={`/portal/${portalAccessId}`} target="_blank" />} variant="outline" size="xs">
            Open
          </Button>
        </>
      )}
      <Button type="button" variant="outline" size="xs" onClick={rotate} disabled={loading}>
        {loading ? "Saving..." : portalAccessId ? "Rotate" : "Generate"}
      </Button>
    </div>
  );
}
