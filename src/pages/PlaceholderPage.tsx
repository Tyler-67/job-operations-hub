export default function PlaceholderPage({ title, note }: { title: string; note?: string }) {
  return (
    <div className="p-6">
      <h1 className="text-sm font-semibold">{title}</h1>
      <p className="mt-2 max-w-prose text-xs text-muted-foreground">
        {note ?? "Phase 1 shell. Schema is live; UI lands in Phase 2."}
      </p>
    </div>
  );
}
