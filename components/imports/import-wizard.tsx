"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleX, Download, FileUp, Loader2, MinusCircle, RefreshCw } from "lucide-react";
import { commitImportAction, previewImportAction } from "@/app/actions/imports";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fieldClass } from "@/components/page-header";
import { toCsv } from "@/lib/imports/csv";
import type { ImportPreview } from "@/lib/services/imports";
import { cn } from "cn";

type Kind = "patients" | "providers" | "payers" | "authRules";

const KIND_LABEL: Record<Kind, string> = {
  patients: "Patients",
  providers: "Providers",
  payers: "Payers",
  authRules: "Payer prior-auth rules",
};

const STATUS_STYLE = {
  new: { label: "New", icon: CircleCheck, className: "text-success" },
  update: { label: "Update", icon: RefreshCw, className: "text-info" },
  skip: { label: "Skip", icon: MinusCircle, className: "text-muted-foreground" },
  error: { label: "Error", icon: CircleX, className: "text-critical" },
} as const;

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportWizard({ templates, initialKind }: { templates: Record<Kind, string>; initialKind: Kind }) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setPreview(null);
    setResult(null);
    setError(null);
  }

  async function runPreview(text: string, nextMode = mode, nextKind = kind) {
    setBusy(true);
    reset();
    const response = await previewImportAction({ kind: nextKind, csv: text, mode: nextMode });
    setBusy(false);
    if (!response.ok) setError(response.error);
    else setPreview(response.data ?? null);
  }

  async function commit() {
    if (!csv) return;
    setBusy(true);
    const response = await commitImportAction({ kind, csv, mode });
    setBusy(false);
    if (!response.ok) setError(response.error);
    else {
      setResult(response.data ?? null);
      setPreview(null);
      setCsv(null);
      setFileName("");
    }
  }

  const importable = preview ? preview.counts.new + preview.counts.update : 0;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 rounded-xl border bg-card p-4 text-sm md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="import-kind">What are you importing?</Label>
          <select id="import-kind" className={fieldClass} value={kind} onChange={(event) => { setKind(event.target.value as Kind); reset(); setCsv(null); setFileName(""); }}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((key) => <option key={key} value={key}>{KIND_LABEL[key]}</option>)}
          </select>
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => download(`healthflow-${kind}-template.csv`, templates[kind])}>
            <Download className="size-3.5" aria-hidden /> Download template
          </button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="import-mode">If a record already exists</Label>
          <select id="import-mode" className={fieldClass} value={mode} onChange={(event) => { const next = event.target.value as "skip" | "update"; setMode(next); if (csv) void runPreview(csv, next); }}>
            <option value="skip">Skip it and keep the HealthFlow record</option>
            <option value="update">Update it with values from the file</option>
          </select>
          <p className="text-xs text-muted-foreground">Matched by MRN, NPI, payer ID or name, or payer + code.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="import-file">CSV file (up to 5,000 rows, 2 MB)</Label>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 hover:bg-muted focus-within:outline-2 focus-within:outline-ring">
            <FileUp className="size-4 text-muted-foreground" aria-hidden />
            <span className="truncate">{fileName || "Choose file"}</span>
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) {
                  setError("The file is larger than 2 MB. Split it into smaller files.");
                  return;
                }
                const text = await file.text();
                setFileName(file.name);
                setCsv(text);
                void runPreview(text);
              }}
            />
          </label>
          <p className="text-xs text-muted-foreground">The file is checked, then discarded. HealthFlow doesn&apos;t keep a copy.</p>
        </div>
      </section>

      {busy ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" aria-hidden /> Checking the file…</p>
      ) : null}
      {error ? <p className="rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm" role="alert">{error}</p> : null}

      {result ? (
        <section className="rounded-xl border border-success/30 bg-success-soft p-4 text-sm" role="status">
          <p className="font-semibold">Import finished</p>
          <p>{result.created} added, {result.updated} updated, {result.skipped} skipped{result.errors ? `, ${result.errors} rows with errors were not imported` : ""}.</p>
          <p className="mt-2">
            <Link className="font-medium text-primary hover:underline" href={kind === "authRules" ? "/payers/rules" : `/${kind}`}>View {KIND_LABEL[kind].toLowerCase()}</Link>
          </p>
        </section>
      ) : null}

      {preview ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 text-sm" aria-label="Import preview">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Preview: {preview.totalRows} rows</h2>
              <p className="text-muted-foreground">
                {preview.counts.new} new, {preview.counts.update} to update, {preview.counts.skip} to skip, {preview.counts.error} with errors
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {preview.counts.error ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    download(
                      `healthflow-${kind}-errors.csv`,
                      toCsv([["Row", "Record", "Problem"], ...preview.rows.filter((row) => row.status === "error").map((row) => [String(row.row), row.summary, row.messages.join(" ")])]),
                    )
                  }
                >
                  <Download aria-hidden /> Download errors
                </Button>
              ) : null}
              <Button onClick={() => void commit()} disabled={busy || importable === 0}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Import {importable} {importable === 1 ? "row" : "rows"}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {preview.columns.map((column) => (
              <span key={column.header} className={cn("rounded-md border px-2 py-0.5", column.field ? "bg-muted" : "text-muted-foreground line-through")} title={column.field ? `Mapped to ${column.field}` : "Not used"}>
                {column.header}
              </span>
            ))}
          </div>
          {preview.missingRequired.length ? (
            <p className="text-critical" role="alert">Missing required columns: {preview.missingRequired.join(", ")}. Use the template headers.</p>
          ) : null}
          <div className="max-h-[28rem] overflow-auto rounded-lg border">
            <table className="w-full min-w-[560px] text-left">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="px-3 py-2 font-medium">Row</th>
                  <th scope="col" className="px-3 py-2 font-medium">Result</th>
                  <th scope="col" className="px-3 py-2 font-medium">Record</th>
                  <th scope="col" className="px-3 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 300).map((row) => {
                  const style = STATUS_STYLE[row.status];
                  const Icon = style.icon;
                  return (
                    <tr key={row.row} className="border-b last:border-0 align-top">
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{row.row}</td>
                      <td className={cn("px-3 py-1.5 whitespace-nowrap", style.className)}>
                        <span className="inline-flex items-center gap-1"><Icon className="size-3.5" aria-hidden /> {style.label}</span>
                      </td>
                      <td className="px-3 py-1.5">{row.summary}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{row.messages.join(" ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 300 ? <p className="text-xs text-muted-foreground">Showing the first 300 rows. Every row is checked.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
