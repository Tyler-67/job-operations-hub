import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

// Radix Select forbids an empty-string item value, but the app models "no selection"
// (None / Auto / All) as "". Map "" to a private sentinel at the boundary so callers
// keep using plain "" for both the value and the option.
const EMPTY = "__inline_select_empty__";
const encode = (value: string) => (value === "" ? EMPTY : value);
const decode = (value: string) => (value === EMPTY ? "" : value);

export function InlineSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={encode(value)} onValueChange={(next) => onChange(decode(next))} disabled={disabled}>
      <SelectTrigger className={cn("h-9 rounded-sm px-2 text-xs disabled:opacity-65", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={encode(option.value)} value={encode(option.value)} disabled={option.disabled} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
