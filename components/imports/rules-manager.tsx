"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { deleteAuthRuleAction, saveAuthRuleAction } from "@/app/actions/imports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldClass } from "@/components/page-header";
import { RequirementBadge } from "@/components/imports/requirement-badge";

interface Rule {
  id: string;
  payerName: string;
  codeType: "CPT" | "HCPCS";
  code: string;
  requirement: "REQUIRED" | "NOT_REQUIRED";
  note: string;
}

export function RulesManager({ rules, payers, writable }: { rules: Rule[]; payers: { id: string; name: string }[]; writable: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const shown = rules.filter((rule) => !filter || `${rule.payerName} ${rule.code} ${rule.note}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-5">
      {writable ? (
        <form
          className="grid gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-[1.4fr_0.7fr_0.8fr_1fr_1.4fr_auto] lg:items-end"
          onSubmit={async (event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            setBusy(true);
            setError(null);
            const result = await saveAuthRuleAction({
              payerId: String(form.get("payerId") ?? ""),
              codeType: String(form.get("codeType") ?? "CPT"),
              code: String(form.get("code") ?? ""),
              requirement: String(form.get("requirement") ?? "REQUIRED"),
              note: String(form.get("note") ?? ""),
            });
            setBusy(false);
            if (!result.ok) setError(result.error);
            else {
              formElement.reset();
              router.refresh();
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="rule-payer">Payer</Label>
            <select id="rule-payer" name="payerId" className={fieldClass} required defaultValue="">
              <option value="" disabled>Choose payer</option>
              {payers.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-type">Code set</Label>
            <select id="rule-type" name="codeType" className={fieldClass}>
              <option value="CPT">CPT</option>
              <option value="HCPCS">HCPCS</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-code">Code or prefix</Label>
            <Input id="rule-code" name="code" placeholder="72148 or 7214*" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-req">Prior auth</Label>
            <select id="rule-req" name="requirement" className={fieldClass}>
              <option value="REQUIRED">Required</option>
              <option value="NOT_REQUIRED">Not required</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-note">Note</Label>
            <Input id="rule-note" name="note" placeholder="Source, date checked" />
          </div>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : null} Save rule</Button>
          {error ? <p className="text-destructive sm:col-span-2 lg:col-span-6" role="alert">{error}</p> : null}
        </form>
      ) : null}

      <div className="max-w-sm space-y-1.5 text-sm">
        <Label htmlFor="rule-filter">Search rules</Label>
        <Input id="rule-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Payer, code or note" />
      </div>

      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm">
          <p className="font-medium">No payer rules yet</p>
          <p className="text-muted-foreground">Add the codes each payer requires prior auth for, or import them from a spreadsheet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Payer</th>
                <th scope="col" className="px-3 py-2 font-medium">Code</th>
                <th scope="col" className="px-3 py-2 font-medium">Prior auth</th>
                <th scope="col" className="px-3 py-2 font-medium">Note</th>
                {writable ? <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((rule) => (
                <tr key={rule.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{rule.payerName}</td>
                  <td className="px-3 py-2 tabular-nums"><span className="text-xs text-muted-foreground">{rule.codeType}</span> {rule.code}</td>
                  <td className="px-3 py-2"><RequirementBadge requirement={rule.requirement} /></td>
                  <td className="px-3 py-2 text-muted-foreground">{rule.note}</td>
                  {writable ? (
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="icon" aria-label={`Delete rule ${rule.code} for ${rule.payerName}`} onClick={async () => {
                        const result = await deleteAuthRuleAction(rule.id);
                        if (!result.ok) setError(result.error);
                        else router.refresh();
                      }}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
