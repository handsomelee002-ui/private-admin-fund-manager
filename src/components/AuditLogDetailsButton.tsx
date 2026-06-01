"use client";

import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type AuditLogDetails = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string;
  created_at: string;
  details: unknown;
};

export function AuditLogDetailsButton({ log }: { log: AuditLogDetails }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="View audit details"
            aria-label="View audit details"
          />
        }
      >
        <Eye className="h-3.5 w-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Audit Details</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 text-xs">
          <div className="grid gap-2 rounded-md border border-border/50 bg-muted/20 p-3 sm:grid-cols-2">
            <div>
              <div className="text-muted-foreground">Time</div>
              <div className="font-medium">{log.created_at}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Action</div>
              <div className="font-medium">{log.action}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Entity</div>
              <div className="font-medium">{log.entity_type}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Actor</div>
              <div className="font-medium">{log.actor_id}</div>
            </div>
          </div>
          <div>
            <div className="mb-1 text-muted-foreground">Entity ID</div>
            <div className="break-all rounded-md border border-border/50 bg-muted/20 p-2 font-mono">
              {log.entity_id || "-"}
            </div>
          </div>
          <div>
            <div className="mb-1 text-muted-foreground">Details</div>
            <pre className="max-h-[360px] overflow-auto rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
              {JSON.stringify(log.details ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
