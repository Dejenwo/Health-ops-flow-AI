"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, Loader2, PlugZap } from "lucide-react";
import { saveClearinghouseAction, testClearinghouseAction } from "@/app/actions/integrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldClass } from "@/components/page-header";

interface Overview {
  clearinghouse: {
    provider: "simulator" | "stedi";
    environment: "test" | "production";
    enabled: boolean;
    hasSecret: boolean;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string;
  } | null;
  messages: { id: string; operation: string; outcome: "SUCCESS" | "FAILED"; httpStatus: number | null; attempts: number; durationMs: number; error: string; createdAt: string }[];
}

export function ClearinghousePanel({ overview }: { overview: Overview }) {
  const router = useRouter();
  const current = overview.clearinghouse;
  const [provider, setProvider] = useState<"simulator" | "stedi">(current?.provider ?? "simulator");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 text-sm" aria-labelledby="clearinghouse-heading">
      <div className="flex items-start gap-3">
        <PlugZap className="mt-0.5 size-5 text-primary" aria-hidden />
        <div>
          <h2 id="clearinghouse-heading" className="font-semibold">Eligibility checks (clearinghouse)</h2>
          <p className="text-muted-foreground">
            Checks a patient&apos;s coverage with their payer before you start a request. Uses the payer&apos;s electronic Payer ID, the
            patient&apos;s member ID and the ordering provider&apos;s NPI.
          </p>
        </div>
      </div>
      {current ? (
        <p className="flex items-center gap-1.5">
          {current.lastErrorAt && (!current.lastSuccessAt || current.lastErrorAt > current.lastSuccessAt) ? (
            <><CircleX className="size-4 text-critical" aria-hidden /> Last call failed: {current.lastError}</>
          ) : current.lastSuccessAt ? (
            <><CircleCheck className="size-4 text-success" aria-hidden /> Working. Last success {new Date(current.lastSuccessAt).toLocaleString()}</>
          ) : (
            <>Saved. Not tested yet.</>
          )}
        </p>
      ) : null}
      {message ? <p role="status" className={message.ok ? "text-success" : "text-destructive"}>{message.text}</p> : null}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy("save");
          const result = await saveClearinghouseAction({
            provider,
            environment: String(form.get("environment") ?? "test"),
            apiKey: String(form.get("apiKey") ?? ""),
            enabled: form.get("enabled") === "on",
          });
          setBusy(null);
          setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
          if (result.ok) router.refresh();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="ch-provider">Clearinghouse</Label>
          <select id="ch-provider" className={fieldClass} value={provider} onChange={(event) => setProvider(event.target.value as "simulator" | "stedi")}>
            <option value="simulator">Simulator (demo, contacts no one)</option>
            <option value="stedi">Stedi</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ch-env">Environment</Label>
          <select id="ch-env" name="environment" className={fieldClass} defaultValue={current?.environment ?? "test"}>
            <option value="test">Test (sandbox key)</option>
            <option value="production">Production</option>
          </select>
        </div>
        {provider !== "simulator" ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ch-key">API key</Label>
            <Input id="ch-key" name="apiKey" type="password" autoComplete="off" placeholder={current?.hasSecret && current.provider === provider ? "Saved. Leave blank to keep it." : "Paste the key from your clearinghouse account"} />
            <p className="text-xs text-muted-foreground">Stored encrypted. Sign the clearinghouse&apos;s BAA before using a production key with real patients.</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            The simulator answers instantly. Member IDs ending in 0 come back inactive, 5 say prior auth is required, and 9 simulate a payer timeout.
          </p>
        )}
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" name="enabled" defaultChecked={current?.enabled ?? true} />
          Turn on eligibility checks for staff
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy !== null}>{busy === "save" ? <Loader2 className="animate-spin" aria-hidden /> : null} Save</Button>
          {current ? (
            <Button type="button" variant="outline" disabled={busy !== null} onClick={async () => {
              setBusy("test");
              const result = await testClearinghouseAction();
              setBusy(null);
              setMessage(result.ok ? { ok: true, text: result.data?.message ?? "Connected." } : { ok: false, text: result.error });
              router.refresh();
            }}>
              {busy === "test" ? <Loader2 className="animate-spin" aria-hidden /> : null} Test connection
            </Button>
          ) : null}
        </div>
      </form>
      {overview.messages.length ? (
        <div>
          <h3 className="font-medium">Recent activity</h3>
          <p className="text-xs text-muted-foreground">Only timing and results are logged, never patient details.</p>
          <div className="mt-2 overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">When</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Call</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Result</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Time</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {overview.messages.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="px-2 py-1.5 whitespace-nowrap">{new Date(item.createdAt).toLocaleString()}</td>
                    <td className="px-2 py-1.5">{item.operation.replace("_", " ")}</td>
                    <td className={item.outcome === "SUCCESS" ? "px-2 py-1.5 text-success" : "px-2 py-1.5 text-critical"}>
                      {item.outcome === "SUCCESS" ? "OK" : "Failed"}{item.httpStatus ? ` (${item.httpStatus})` : ""}{item.attempts > 1 ? `, ${item.attempts} tries` : ""}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{item.durationMs} ms</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{item.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
