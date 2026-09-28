"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

interface Hit {
  id: string;
  href: string;
  title: string;
  detail: string;
}

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ patients: Hit[]; authorizations: Hit[]; tasks: Hit[] }>({
    patients: [],
    authorizations: [],
    tasks: [],
  });

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      if (query.trim().length < 2) {
        setResults({ patients: [], authorizations: [], tasks: [] });
        return;
      }
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) return;
      setResults(await response.json());
    }, 150);
    return () => clearTimeout(handle);
  }, [query, open]);

  function go(href: string) {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search the organization" description="Search patients, authorization numbers, procedures, and tasks.">
      <CommandInput placeholder="Search patients, authorization numbers, procedures, tasks" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{query.trim().length < 2 ? "Type at least two characters." : "No matches in this organization."}</CommandEmpty>
        <ResultGroup heading="Patients" items={results.patients} onSelect={go} />
        <ResultGroup heading="Authorizations" items={results.authorizations} onSelect={go} />
        <ResultGroup heading="Tasks" items={results.tasks} onSelect={go} />
      </CommandList>
    </CommandDialog>
  );
}

function ResultGroup({ heading, items, onSelect }: { heading: string; items: Hit[]; onSelect: (href: string) => void }) {
  if (!items.length) return null;
  return (
    <CommandGroup heading={heading}>
      {items.map((item) => (
        <CommandItem key={item.id} value={`${heading} ${item.title} ${item.detail}`} onSelect={() => onSelect(item.href)}>
          <span className="flex flex-col">
            <span>{item.title}</span>
            <span className="text-xs text-muted-foreground">{item.detail}</span>
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
