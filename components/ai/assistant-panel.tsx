"use client";

import { useState } from "react";
import Link from "next/link";
import { operationalQueryAction } from "@/app/actions/workflow";
import { AiDisclaimer } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PROMPTS = [
  ["needs_attention", "What needs attention today?"],
  ["payer_overdue", "Which payers are late on a decision?"],
  ["expiring_authorizations", "Which approvals are expiring or out of window?"],
  ["appeal_deadlines", "Which appeal deadlines are coming up?"],
  ["overdue_authorizations", "Which authorizations are overdue?"],
  ["missing_documents", "Which cases are missing documents?"],
  ["pending_over_five_days", "Which cases have been pending more than five days?"],
  ["summarize_urgent", "Summarize urgent work."],
] as const;

interface Result {
  title: string;
  disclaimer: string;
  narrative: string;
  items: { href: string; title: string; detail: string }[];
}

export function AssistantPanel() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function ask(key: string) {
    setPending(true);
    setError(null);
    const response = await operationalQueryAction(key);
    setPending(false);
    if (!response.ok) {
      setError(response.error);
      setResult(null);
      return;
    }
    setResult(response.data ?? null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PROMPTS.map(([key, label]) => (
          <Button key={key} variant="outline" disabled={pending} onClick={() => void ask(key)}>{label}</Button>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get("q") ?? "");
        void ask(value);
      }}>
        <Input name="q" aria-label="Operational question" placeholder="Ask one of the operational questions" />
        <Button type="submit" disabled={pending}>Ask</Button>
      </form>
      <p className="text-xs text-muted-foreground">Questions run predefined organization-scoped lookups. Free text is matched to those lookups. SQL is never generated.</p>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {result ? (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-lg font-medium">{result.title}</h2>
          <AiDisclaimer className="mt-2" />
          <p className="mt-3 text-sm">{result.narrative}</p>
          <ul className="mt-4 space-y-2">
            {result.items.map((item) => (
              <li key={item.href + item.detail}>
                <Link href={item.href} className="text-sm font-medium text-primary">{item.title}</Link>
                <p className="text-xs text-muted-foreground">{item.detail}</p>
              </li>
            ))}
          </ul>
          {result.items.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nothing matched.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
