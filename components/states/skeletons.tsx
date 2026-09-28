import { Skeleton } from "@/components/ui/skeleton";

/** Loading shapes that match the real layouts so pages do not jump when data arrives. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="space-y-4 rounded-xl border bg-card p-4">
            <Skeleton className="h-4 w-28" />
            <div className="grid grid-cols-2 gap-4">
              {[0, 1, 2, 3].map((cell) => (
                <div key={cell} className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-7 w-12" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

export function QueueSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading authorizations">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-9 w-full" />
      <div className="rounded-xl border bg-card">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 border-b p-3 last:border-0">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-20 rounded-md" />
            <Skeleton className="hidden h-5 w-24 rounded-md sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CaseSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading case">
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48 rounded-xl md:col-span-2" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  );
}

export function PatientSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading patient">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-9 w-full max-w-md" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
