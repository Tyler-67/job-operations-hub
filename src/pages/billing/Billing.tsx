// Placeholder for the Billing page (invoicing / AR). Intentionally empty — the header matches
// the other pages; the body is a coming-soon state until the feature is built out.
import { CreditCard } from "lucide-react";

export default function Billing() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Billing</h1>
          <p className="text-xs text-muted-foreground">Invoicing and accounts receivable.</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <CreditCard className="h-6 w-6" />
        <p className="text-sm">Billing is coming soon.</p>
      </div>
    </div>
  );
}
