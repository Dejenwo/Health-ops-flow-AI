"use client";

import { useState } from "react";
import { acceptInviteAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";

export function AcceptInvite({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-semibold">Accept invitation</h1>
      <p className="mt-2 text-sm text-muted-foreground">You must be signed in with the invited email address.</p>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      <Button className="mt-6" onClick={() => void acceptInviteAction(token).then((result) => {
        if (result && !result.ok) setError(result.error);
      })}>Join organization</Button>
    </main>
  );
}
