"use client";
import type React from "react";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/** Filters sit inline on desktop and collapse behind a button on phones. */
export function FilterBar({ activeCount, children }: { activeCount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button type="button" variant="outline" className="md:hidden" aria-expanded={open} aria-controls="queue-filters" onClick={() => setOpen((value) => !value)}>
        <SlidersHorizontal aria-hidden /> Filters{activeCount ? ` (${activeCount})` : ""}
      </Button>
      <div id="queue-filters" className={cn("mt-3 md:mt-0 md:block", open ? "block" : "hidden")}>
        {children}
      </div>
    </div>
  );
}
