"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PortalAccessEntryForm() {
  const router = useRouter();
  const [portalAccessId, setPortalAccessId] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessId = portalAccessId.trim();
    if (accessId) {
      router.push(`/portal/${encodeURIComponent(accessId)}`);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="portalAccessId">Statement access ID</Label>
        <Input
          id="portalAccessId"
          value={portalAccessId}
          onChange={(event) => setPortalAccessId(event.target.value)}
          autoComplete="off"
          required
        />
      </div>
      <Button className="w-full" type="submit">View statement</Button>
    </form>
  );
}
