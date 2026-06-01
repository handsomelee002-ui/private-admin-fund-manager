import { TableCell } from "@/components/ui/table";

type NotesTableCellProps = {
  value?: string | null;
  className?: string;
  previewLength?: number;
};

const NOTE_PREVIEW_LENGTH = 8;

export function NotesTableCell({ value, className = "pr-6", previewLength = NOTE_PREVIEW_LENGTH }: NotesTableCellProps) {
  const text = value?.trim() || "-";
  const hasNote = text !== "-";
  const preview = hasNote && text.length > previewLength
    ? `${text.slice(0, previewLength)}...`
    : text;

  return (
    <TableCell className={`w-[180px] max-w-[180px] overflow-hidden text-muted-foreground ${className}`}>
      <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={hasNote ? text : undefined}>
        {preview}
      </span>
    </TableCell>
  );
}
