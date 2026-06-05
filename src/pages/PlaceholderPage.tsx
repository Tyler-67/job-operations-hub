export default function PlaceholderPage({ title, note }: { title: string; note?: string }) {
  return (
    <div className="p-6">
      <h1 className="text-sm font-semibold">{title}</h1>
      <p className="mt-2 max-w-prose text-xs text-muted-foreground">
        {note ?? "This workflow is scaffolded and waiting on its production handler."}
      </p>
    </div>
  );
}
