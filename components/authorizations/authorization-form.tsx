"use client";

import React, { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleDashed, Copy, Plus, Trash2 } from "lucide-react";
import { saveAuthorizationAction } from "@/app/actions/records";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fieldClass } from "@/components/page-header";
import { authorizationSchema } from "@/lib/domain/schemas";
import { CODE_TYPES, PRIORITIES, REVIEW_TYPES, SITES_OF_CARE, UNIT_TYPES } from "@/lib/domain/types";
import { PRIORITY_LABEL, REVIEW_TYPE_LABEL, SITE_OF_CARE_LABEL, UNIT_TYPE_LABEL } from "@/lib/domain/labels";
import { isValidIcd10, isValidServiceCode, PLACE_OF_SERVICE, POS_PATTERN } from "@/lib/domain/codes";
import { authRequirement } from "@/lib/domain/auth-rules";
import type { PayerAuthRule } from "@/lib/domain/types";
import { RequirementBadge } from "@/components/imports/requirement-badge";
import { cn } from "cn";
import type { z } from "zod";

type Input = z.input<typeof authorizationSchema>;
type Output = z.output<typeof authorizationSchema>;

export interface Option {
  id: string;
  label: string;
}

export interface PatientOption extends Option {
  memberId?: string;
  groupNumber?: string;
  primaryPayerId?: string | null;
}

const EMPTY_LINE = { id: "", codeType: "CPT" as const, code: "", modifiers: "", description: "", requestedUnits: 1, unitType: "UNITS" as const };

export function AuthorizationForm({
  id,
  values,
  patients,
  providers,
  payers,
  members,
  canAssign,
  authRules = [],
}: {
  id?: string;
  values?: Partial<Input>;
  patients: PatientOption[];
  providers: Option[];
  payers: Option[];
  members: Option[];
  canAssign: boolean;
  authRules?: PayerAuthRule[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Input, unknown, Output>({
    resolver: zodResolver(authorizationSchema),
    defaultValues: {
      patientId: "",
      providerId: "",
      renderingProviderId: "",
      payerId: "",
      memberId: "",
      groupNumber: "",
      procedure: "",
      lines: [EMPTY_LINE],
      diagnoses: [{ code: "", description: "" }],
      placeOfService: "11",
      siteOfCare: "OFFICE",
      facilityName: "",
      requestedServiceDate: "",
      priority: "NORMAL",
      reviewType: "STANDARD",
      clinicalReason: "",
      assignedUserId: "",
      internalNotes: "",
      ...values,
    },
  });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const diagnoses = useFieldArray({ control: form.control, name: "diagnoses" });
  const errors = form.formState.errors;

  async function onSubmit(data: Output) {
    setError(null);
    const result = await saveAuthorizationAction(id ?? null, data);
    if (result && !result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  const patientField = form.register("patientId");
  const watched = form.watch();
  const preview = [
    { label: "Patient and payer chosen", ok: Boolean(watched.patientId && watched.payerId) },
    { label: "Member ID", ok: Boolean(String(watched.memberId ?? "").trim()) },
    { label: "Ordering provider", ok: Boolean(watched.providerId) },
    {
      label: "Valid service codes and units",
      ok: (watched.lines ?? []).length > 0 && (watched.lines ?? []).every((line) => isValidServiceCode(line.codeType, String(line.code ?? "")) && Number(line.requestedUnits) >= 1),
    },
    { label: "Valid ICD-10-CM diagnosis", ok: (watched.diagnoses ?? []).length > 0 && (watched.diagnoses ?? []).every((entry) => isValidIcd10(String(entry.code ?? ""))) },
    { label: "Place of service", ok: POS_PATTERN.test(String(watched.placeOfService ?? "")) },
    { label: "Service date", ok: /^\d{4}-\d{2}-\d{2}$/.test(String(watched.requestedServiceDate ?? "")) },
  ];
  const readyCount = preview.filter((item) => item.ok).length;
  const lineRequirements = (watched.lines ?? []).map((line) =>
    watched.payerId && isValidServiceCode(line.codeType, String(line.code ?? ""))
      ? authRequirement(authRules, watched.payerId, line.codeType, String(line.code ?? "")).requirement
      : null,
  );
  const knownLines = lineRequirements.filter(Boolean);
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    for (const section of SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem]">
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" noValidate>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

      <Section id="section-patient" title="Patient and payer">
        <SelectField
          label="Patient"
          error={errors.patientId?.message}
          {...patientField}
          onChange={(event) => {
            void patientField.onChange(event);
            const patient = patients.find((item) => item.id === event.target.value);
            if (patient) {
              if (!form.getValues("memberId") && patient.memberId) form.setValue("memberId", patient.memberId);
              if (!form.getValues("groupNumber") && patient.groupNumber) form.setValue("groupNumber", patient.groupNumber);
              if (!form.getValues("payerId") && patient.primaryPayerId) form.setValue("payerId", patient.primaryPayerId);
            }
          }}
        >
          <option value="">Select patient</option>
          {patients.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </SelectField>
        <SelectField label="Payer" error={errors.payerId?.message} {...form.register("payerId")}>
          <option value="">Select payer</option>
          {payers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </SelectField>
        <Field label="Member ID" hint="Required before submission."><Input {...form.register("memberId")} /></Field>
        <Field label="Group number"><Input {...form.register("groupNumber")} /></Field>
      </Section>

      <Section id="section-providers" title="Providers and setting">
        <SelectField label="Ordering provider" error={errors.providerId?.message} {...form.register("providerId")}>
          <option value="">Select provider</option>
          {providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </SelectField>
        <SelectField label="Rendering provider" {...form.register("renderingProviderId")}>
          <option value="">Same as ordering</option>
          {providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </SelectField>
        <SelectField label="Place of service" error={errors.placeOfService?.message} {...form.register("placeOfService")}>
          {Object.entries(PLACE_OF_SERVICE).map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}
        </SelectField>
        <SelectField label="Site of care" {...form.register("siteOfCare")}>
          {SITES_OF_CARE.map((site) => <option key={site} value={site}>{SITE_OF_CARE_LABEL[site]}</option>)}
        </SelectField>
        <Field label="Facility"><Input {...form.register("facilityName")} placeholder="Where the service happens" /></Field>
        <Field label="Requested service date" error={errors.requestedServiceDate?.message}>
          <Input type="date" {...form.register("requestedServiceDate")} />
        </Field>
      </Section>

      <Section id="section-request" title="Request" columns={1}>
        <Field label="Request summary" error={errors.procedure?.message} hint="A short title, e.g. Right knee arthroplasty. Codes go on the lines below.">
          <Input {...form.register("procedure")} />
        </Field>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Service lines</legend>
          {typeof errors.lines?.message === "string" ? <p className="text-xs text-destructive" role="alert">{errors.lines.message}</p> : null}
          {lines.fields.map((field, index) => {
            const lineErrors = errors.lines?.[index];
            return (
              <div key={field.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-12">
                <input type="hidden" {...form.register(`lines.${index}.id`)} />
                <div className="sm:col-span-2">
                  <Label htmlFor={`line-${index}-type`} className="text-xs">Code set</Label>
                  <select id={`line-${index}-type`} className={fieldClass} {...form.register(`lines.${index}.codeType`)}>
                    {CODE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor={`line-${index}-code`} className="text-xs">Code</Label>
                  <Input id={`line-${index}-code`} {...form.register(`lines.${index}.code`)} aria-label={`Line ${index + 1} code`} />
                  <FieldError message={lineErrors?.code?.message} />
                  {lineRequirements[index] ? <RequirementBadge requirement={lineRequirements[index]!} className="mt-1" /> : null}
                </div>
                <div className="sm:col-span-3">
                  <Label htmlFor={`line-${index}-desc`} className="text-xs">Description</Label>
                  <Input id={`line-${index}-desc`} {...form.register(`lines.${index}.description`)} aria-label={`Line ${index + 1} description`} />
                  <FieldError message={lineErrors?.description?.message} />
                </div>
                <div className="sm:col-span-1">
                  <Label htmlFor={`line-${index}-mod`} className="text-xs">Mod.</Label>
                  <Input id={`line-${index}-mod`} {...form.register(`lines.${index}.modifiers`)} placeholder="RT" />
                  <FieldError message={lineErrors?.modifiers?.message} />
                </div>
                <div className="sm:col-span-1">
                  <Label htmlFor={`line-${index}-units`} className="text-xs">Qty</Label>
                  <Input id={`line-${index}-units`} type="number" min={1} {...form.register(`lines.${index}.requestedUnits`)} aria-label={`Line ${index + 1} units`} />
                  <FieldError message={lineErrors?.requestedUnits?.message} />
                </div>
                <div className="sm:col-span-1">
                  <Label htmlFor={`line-${index}-unit`} className="text-xs">Unit</Label>
                  <select id={`line-${index}-unit`} className={fieldClass} {...form.register(`lines.${index}.unitType`)}>
                    {UNIT_TYPES.map((unit) => <option key={unit} value={unit}>{UNIT_TYPE_LABEL[unit]}</option>)}
                  </select>
                </div>
                <div className="flex items-end gap-0.5 sm:col-span-2 sm:justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Duplicate line ${index + 1}`}
                    title="Duplicate line"
                    disabled={lines.fields.length >= 25}
                    onClick={() => {
                      const current = form.getValues(`lines.${index}`);
                      lines.insert(index + 1, { ...current, id: "" });
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${index + 1}`} title="Remove line" disabled={lines.fields.length === 1} onClick={() => lines.remove(index)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm" onClick={() => lines.append(EMPTY_LINE)} disabled={lines.fields.length >= 25}>
            <Plus className="size-4" /> Add service line
          </Button>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Diagnoses (first is primary)</legend>
          {typeof errors.diagnoses?.message === "string" ? <p className="text-xs text-destructive" role="alert">{errors.diagnoses.message}</p> : null}
          {diagnoses.fields.map((field, index) => (
            <div key={field.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-12">
              <div className="sm:col-span-3">
                <Label htmlFor={`dx-${index}-code`} className="text-xs">ICD-10-CM</Label>
                <Input id={`dx-${index}-code`} {...form.register(`diagnoses.${index}.code`)} aria-label={`Diagnosis ${index + 1} code`} />
                <FieldError message={errors.diagnoses?.[index]?.code?.message} />
              </div>
              <div className="sm:col-span-8">
                <Label htmlFor={`dx-${index}-desc`} className="text-xs">Description</Label>
                <Input id={`dx-${index}-desc`} {...form.register(`diagnoses.${index}.description`)} aria-label={`Diagnosis ${index + 1} description`} />
                <FieldError message={errors.diagnoses?.[index]?.description?.message} />
              </div>
              <div className="flex items-end sm:col-span-1">
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove diagnosis ${index + 1}`} disabled={diagnoses.fields.length === 1} onClick={() => diagnoses.remove(index)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => diagnoses.append({ code: "", description: "" })} disabled={diagnoses.fields.length >= 12}>
            <Plus className="size-4" /> Add diagnosis
          </Button>
        </fieldset>
      </Section>

      <Section id="section-handling" title="Handling">
        <Field label="Priority">
          <select className={fieldClass} {...form.register("priority")}>
            {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}
          </select>
        </Field>
        <Field label="Review type" hint="Expedited only when waiting could seriously jeopardize the patient's health.">
          <select className={fieldClass} {...form.register("reviewType")}>
            {REVIEW_TYPES.map((type) => <option key={type} value={type}>{REVIEW_TYPE_LABEL[type]}</option>)}
          </select>
        </Field>
        <Field label="Assignee">
          <select className={fieldClass} disabled={!canAssign} {...form.register("assignedUserId")}>
            <option value="">Unassigned</option>
            {members.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </Field>
      </Section>

      <Section id="section-notes" title="Notes" columns={1}>
        <Field label="Reason for request" error={errors.clinicalReason?.message} hint="Administrative context only. Do not treat this as a clinical recommendation.">
          <Textarea {...form.register("clinicalReason")} rows={3} />
        </Field>
        <Field label="Internal notes"><Textarea {...form.register("internalNotes")} rows={3} /></Field>
      </Section>

      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full sm:w-auto">{id ? "Save changes" : "Create authorization"}</Button>
      </div>
    </form>
    <aside className="mt-8 space-y-4 lg:sticky lg:top-20 lg:mt-0 lg:self-start" aria-label="Form progress">
      <nav aria-label="Form sections" className="hidden lg:block">
        <ul className="space-y-0.5 border-l text-sm">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className={cn(
                  "-ml-px block border-l-2 py-1 pl-3 transition-colors hover:text-foreground",
                  activeSection === section.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground",
                )}
                aria-current={activeSection === section.id ? "true" : undefined}
              >
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <section className="rounded-xl border bg-card p-4 text-sm" aria-label="Packet preview">
        <h2 className="font-semibold">Packet preview</h2>
        <p className="text-xs text-muted-foreground">{readyCount} of {preview.length} form items ready</p>
        <ul className="mt-3 space-y-1.5">
          {preview.map((item) => (
            <li key={item.label} className="flex items-start gap-2">
              {item.ok ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-label="Ready" role="img" />
              ) : (
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not yet" role="img" />
              )}
              <span className={item.ok ? "text-muted-foreground" : ""}>{item.label}</span>
            </li>
          ))}
        </ul>
        {knownLines.length ? (
          <div className="mt-3 border-t pt-3">
            <h3 className="text-xs font-medium">Payer rules</h3>
            <p className="text-xs text-muted-foreground">
              {knownLines.every((value) => value === "NOT_REQUIRED")
                ? "Your rules say none of these codes need prior auth for this payer. Confirm before creating a request."
                : knownLines.some((value) => value === "UNKNOWN")
                  ? "Some codes have no rule on file. Check the payer's list before submitting."
                  : "Prior auth is required for at least one code."}
            </p>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-muted-foreground">Documents are added after the case is created. The full checklist, including payer-required documents, appears on the case.</p>
      </section>
    </aside>
    </div>
  );
}

const SECTIONS = [
  { id: "section-patient", title: "Patient & payer" },
  { id: "section-providers", title: "Providers & setting" },
  { id: "section-request", title: "Request" },
  { id: "section-handling", title: "Handling" },
  { id: "section-notes", title: "Notes" },
];

function Section({ id, title, columns = 2, children }: { id: string; title: string; columns?: 1 | 2; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className={columns === 2 ? "grid grid-cols-1 gap-4 md:grid-cols-2" : "space-y-4"}>{children}</div>
    </section>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <span className="mt-1 block text-xs text-destructive" role="alert">{message}</span> : null;
}

function fieldId(label: string) {
  return `auth-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  const id = fieldId(label);
  const control = React.Children.count(children) === 1 && React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id })
    : children;
  return (
    <div className="space-y-1.5 text-sm">
      <Label htmlFor={id}>{label}</Label>
      {control}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <FieldError message={error} />
    </div>
  );
}

function SelectField({
  label,
  error,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }) {
  return (
    <Field label={label} error={error}>
      <select className={fieldClass} {...props}>{children}</select>
    </Field>
  );
}
