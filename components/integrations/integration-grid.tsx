"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { integrationRequestAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function IntegrationGrid({
  items,
  canRequest,
}: {
  items: { key: string; name: string; category: string; description: string; availability: string; note: string; requestStatus: string | null }[];
  canRequest: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {message ? <p className="text-sm" role="status">{message}</p> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <article key={item.key} className="flex flex-col rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">{item.name}</h2>
              <Badge variant="outline">{item.requestStatus === "REQUESTED" ? "Requested" : item.availability === "COMING_SOON" ? "Coming soon" : "Available"}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{item.category}</p>
            <p className="mt-3 flex-1 text-sm text-muted-foreground">{item.description}</p>
            <p className="mt-3 text-xs">{item.note}</p>
            {canRequest ? (
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => {
                  void integrationRequestAction(item.key).then((result) => {
                    setMessage(result.ok ? `${item.name} request recorded. No connection was created.` : result.error);
                    router.refresh();
                  });
                }}
              >
                Request integration
              </Button>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
