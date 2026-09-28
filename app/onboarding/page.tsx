"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { completeOnboardingAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldClass } from "@/components/page-header";
import { onboardingSchema } from "@/lib/domain/schemas";
import { ORG_TYPES } from "@/lib/domain/types";
import { ORG_TYPE_LABEL } from "@/lib/domain/labels";
import type { z } from "zod";

type Values = z.infer<typeof onboardingSchema>;

const STEPS = ["Organization", "Profile", "Workflows", "Review"];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      organizationName: "",
      organizationType: "CLINIC",
      specialty: "",
      providerCount: 1,
      fullName: "",
      jobTitle: "",
      phone: "",
      eligibility: false,
      referrals: false,
      denials: false,
      documentManagement: true,
    },
  });

  async function next() {
    const fields: (keyof Values)[][] = [
      ["organizationName", "organizationType", "specialty", "providerCount"],
      ["fullName", "jobTitle", "phone"],
      [],
    ];
    if (step < 3) {
      const valid = fields[step].length ? await form.trigger(fields[step]) : true;
      if (valid) setStep((current) => current + 1);
      return;
    }
    setPending(true);
    const result = await completeOnboardingAction(form.getValues());
    setPending(false);
    if (result && !result.ok) setError(result.error);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12">
      <p className="text-sm font-medium text-primary">Set up HealthFlow</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{STEPS[step]}</h1>
      <ol className="mt-4 flex gap-2 text-xs text-muted-foreground">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? "font-medium text-foreground" : undefined}>{index + 1}. {label}</li>
        ))}
      </ol>
      <div className="mt-8 space-y-4">
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        {step === 0 ? (
          <>
            <Field label="Organization name" error={form.formState.errors.organizationName?.message}>
              <Input {...form.register("organizationName")} />
            </Field>
            <Field label="Organization type">
              <select className={fieldClass} {...form.register("organizationType")}>
                {ORG_TYPES.map((type) => <option key={type} value={type}>{ORG_TYPE_LABEL[type]}</option>)}
              </select>
            </Field>
            <Field label="Specialty" error={form.formState.errors.specialty?.message}>
              <Input {...form.register("specialty")} />
            </Field>
            <Field label="Provider count" error={form.formState.errors.providerCount?.message}>
              <Input type="number" min={1} {...form.register("providerCount")} />
            </Field>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <Field label="Full name" error={form.formState.errors.fullName?.message}><Input {...form.register("fullName")} /></Field>
            <Field label="Job title" error={form.formState.errors.jobTitle?.message}><Input {...form.register("jobTitle")} /></Field>
            <Field label="Phone"><Input {...form.register("phone")} /></Field>
          </>
        ) : null}
        {step === 2 ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Workflows</legend>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked disabled /> Prior authorization (enabled)</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("eligibility")} /> Eligibility <span className="text-muted-foreground">(tracked only — not built yet)</span></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("referrals")} /> Referrals</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("denials")} /> Denials</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("documentManagement")} /> Document management</label>
          </fieldset>
        ) : null}
        {step === 3 ? (
          <div className="rounded-xl border bg-card p-4 text-sm">
            <p>{form.watch("organizationName")} · {form.watch("specialty")}</p>
            <p className="text-muted-foreground">{form.watch("fullName")}, {form.watch("jobTitle")}</p>
            <p className="mt-2 text-muted-foreground">Prior authorization will be the active workflow. Other selections are saved as intent only.</p>
          </div>
        ) : null}
        <div className="flex gap-2">
          {step > 0 ? <Button type="button" variant="outline" onClick={() => setStep((current) => current - 1)}>Back</Button> : null}
          <Button type="button" onClick={() => void next()} disabled={pending}>{step === 3 ? (pending ? "Finishing…" : "Go to dashboard") : "Continue"}</Button>
        </div>
      </div>
    </main>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
