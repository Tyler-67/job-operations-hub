import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Guard for row-level onClick handlers (the click-anywhere-on-the-row pattern): stay out of
// the way when the click means something else — a modified click (open in new tab), a click
// on a real control inside the row, or the mouse-up that ends a text selection.
export function shouldIgnoreRowClick(event: ReactMouseEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true;
  if ((event.target as HTMLElement).closest("a, button, input, select, textarea, label")) return true;
  if (window.getSelection()?.toString()) return true;
  return false;
}

// Shared column sorting for the ops tables (Dashboard, Jobs, Expenses, Supply Houses, Users).
// Each page declares a module-level accessor map (sort key -> row value) and renders
// <SortableTh> heads; clicking cycles asc -> desc -> off. Nulls always sort last so
// "sort by inspection date" doesn't bury the dated rows under the blank ones.

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}
export type SortValue = string | number | boolean | null | undefined;
export type SortAccessors<T> = Record<string, (row: T) => SortValue>;

export function useTableSort<T>(rows: T[], accessors: SortAccessors<T>, initial: SortState | null = null) {
  const [sort, setSort] = useState<SortState | null>(initial);

  const sorted = useMemo(() => {
    const accessor = sort ? accessors[sort.key] : undefined;
    if (!sort || !accessor) return rows;
    const mult = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = normalize(accessor(a));
      const vb = normalize(accessor(b));
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * mult;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" }) * mult;
    });
  }, [rows, sort, accessors]);

  function toggleSort(key: string) {
    setSort((current) => {
      if (current?.key !== key) return { key, dir: "asc" };
      return current.dir === "asc" ? { key, dir: "desc" } : null;
    });
  }

  return { sorted, sort, toggleSort };
}

function normalize(value: SortValue): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

export function SortableTh({ label, sortKey, sort, onSort, className, align = "left" }: {
  label: string;
  sortKey?: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const active = sortKey !== undefined && sort?.key === sortKey;
  if (!sortKey) {
    return <th className={cn("border-b border-border px-3 py-2 font-medium", align === "right" ? "text-right" : "text-left", className)}>{label}</th>;
  }
  return (
    <th
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("border-b border-border px-3 py-2 font-medium", align === "right" ? "text-right" : "text-left", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex max-w-full items-center gap-0.5 uppercase tracking-wider hover:text-foreground",
          align === "right" && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        <span className="truncate">{label}</span>
        {active
          ? (sort.dir === "asc" ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />)
          : <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />}
      </button>
    </th>
  );
}
