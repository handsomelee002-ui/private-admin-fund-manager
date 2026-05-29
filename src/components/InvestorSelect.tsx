"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type InvestorOption = {
  id: string;
  name: string | null;
};

export function investorDisplayName(investor: InvestorOption | undefined) {
  const name = investor?.name?.trim();
  return name || "Unknown investor";
}

export function InvestorSelect({
  investors,
  value,
  onValueChange,
  placeholder = "Select investor",
  disabled,
}: {
  investors: InvestorOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const selectedInvestor = investors.find((investor) => investor.id === value);

  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue || "")} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder}>
          {value ? investorDisplayName(selectedInvestor) : placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {investors.map((investor) => (
          <SelectItem key={investor.id} value={investor.id}>
            {investorDisplayName(investor)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
