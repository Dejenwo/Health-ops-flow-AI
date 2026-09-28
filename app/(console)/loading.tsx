export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="h-64 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
