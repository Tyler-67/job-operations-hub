import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import type { SelectOption } from "@/components/InlineSelect";
import { cn } from "@/lib/utils";

// Multi-select sibling of InlineSelect: an app-styled dropdown whose popover holds a
// checkbox list, so several options can be picked at once. Same compact chrome as
// InlineSelect (h-9 text-xs, rounded-sm) and the same {value,label} option shape, but the
// value is a string[] the caller owns. The trigger summarizes the selection ("N selected");
// a Select all / Clear toggle covers the common bulk case.
export function InlineMultiSelect({
  values,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const selected = options.filter((option) => values.includes(option.value));
  const label = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? selected[0].label
      : `${selected.length} selected`;
  const allSelected = options.length > 0 && options.every((option) => values.includes(option.value));

  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled || options.length === 0}
        className={cn(
          "flex h-9 items-center justify-between gap-2 rounded-sm border border-input bg-background px-2 text-xs disabled:opacity-65",
          selected.length === 0 && "text-muted-foreground",
          className,
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-56 p-1">
        <div className="flex items-center justify-between px-2 py-1">
          <button
            type="button"
            className="text-2xs font-medium text-primary hover:underline"
            onClick={() => onChange(allSelected ? [] : options.map((option) => option.value))}
          >
            {allSelected ? "Clear all" : "Select all"}
          </button>
          <span className="text-2xs text-muted-foreground">{values.length}/{options.length}</span>
        </div>
        <div className="max-h-60 overflow-auto">
          {options.map((option) => (
            <div
              key={option.value}
              role="button"
              tabIndex={option.disabled ? -1 : 0}
              onClick={() => { if (!option.disabled) toggle(option.value); }}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && !option.disabled) {
                  event.preventDefault();
                  toggle(option.value);
                }
              }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent",
                option.disabled && "pointer-events-none opacity-50",
              )}
            >
              <Checkbox
                checked={values.includes(option.value)}
                onCheckedChange={() => {}}
                tabIndex={-1}
                className="pointer-events-none h-3.5 w-3.5"
              />
              <span className="truncate">{option.label}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
