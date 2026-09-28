"use client";

import Link from "next/link";
import { OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shows no stack trace and no record data. The digest lets support find the server log entry. */
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border bg-card p-8 text-center" role="alert">
      <OctagonAlert className="mx-auto size-8 text-critical" aria-hidden />
      <h1 className="mt-3 text-xl font-semibold">This page could not load</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Nothing was changed. Try again, and if it keeps happening, give your administrator the reference below.
      </p>
      {error.digest ? <p className="mt-3 text-xs text-muted-foreground">Reference {error.digest}</p> : null}
      <div className="mt-5 flex justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/dashboard" className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted">Go to dashboard</Link>
      </div>
    </div>
  );
}
