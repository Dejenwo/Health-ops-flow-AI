"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { savePayerAction, saveProviderAction } from "@/app/actions/records";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fieldClass } from "@/components/page-header";
import { payerSchema, providerSchema } from "@/lib/domain/schemas";
import { DOCUMENT_CATEGORIES, PAYER_TYPES, PROVIDER_STATUSES } from "@/lib/domain/types";
import { DOCUMENT_CATEGORY_LABEL, PAYER_TYPE_LABEL } from "@/lib/domain/labels";
import { PAYER_TIMEFRAME_DEFAULTS } from "@/lib/domain/sla";
import type { z } from "zod";

export function ProviderDialog({ values, id, label = "Add provider" }: { id?: string; label?: string; values?: Partial<z.infer<typeof providerSchema>> }) {
  return (
    <RecordDialog title={id ? "Edit provider" : "Add provider"} label={label}>
      <ProviderFields id={id} values={values} />
    </RecordDialog>
  );
}

export function PayerDialog({ values, id, label = "Add payer" }: { id?: string; label?: string; values?: Partial<z.input<typeof payerSchema>> }) {
  return (
    <RecordDialog title={id ? "Edit payer" : "Add payer"} label={label}>
      <PayerFields id={id} values={values} />
    </RecordDialog>
  );
}

function RecordDialog({ title, label, children }: { title: string; label: string; children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{label}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function ProviderFields({ id, values }: { id?: string; values?: Partial<z.infer<typeof providerSchema>> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof providerSchema>>({
    resolver: zodResolver(providerSchema),
    defaultValues: { name: "", npi: "", specialty: "", phone: "", email: "", status: "ACTIVE", organizationName: "", ...values },
  });
  return (
    <form className="grid gap-3" onSubmit={form.handleSubmit(async (data) => {
      const result = await saveProviderAction(id ?? null, data);
      if (!result.ok) setError(result.error);
      else router.refresh();
    })}>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Label>Name</Label><Input {...form.register("name")} />
      <Label htmlFor="provider-npi">NPI</Label><Input id="provider-npi" inputMode="numeric" maxLength={10} {...form.register("npi")} placeholder="10 digits" />
      {form.formState.errors.npi?.message ? <p className="text-xs text-destructive" role="alert">{form.formState.errors.npi.message}</p> : null}
      <Label>Specialty</Label><Input {...form.register("specialty")} />
      <Label>Phone</Label><Input {...form.register("phone")} />
      <Label>Email</Label><Input {...form.register("email")} />
      <Label>Organization</Label><Input {...form.register("organizationName")} />
      <select className={fieldClass} {...form.register("status")}>
        {PROVIDER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
      </select>
      <Button type="submit">Save</Button>
    </form>
  );
}

function PayerFields({ id, values }: { id?: string; values?: Partial<z.input<typeof payerSchema>> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const initialType = values?.type ?? "COMMERCIAL";
  const form = useForm<z.input<typeof payerSchema>, unknown, z.output<typeof payerSchema>>({
    resolver: zodResolver(payerSchema),
    defaultValues: {
      name: "",
      type: initialType,
      identifier: "",
      phone: "",
      fax: "",
      website: "",
      notes: "",
      active: true,
      ...PAYER_TIMEFRAME_DEFAULTS[initialType],
      requiredDocuments: [],
      ...values,
    },
  });
  const typeField = form.register("type");
  return (
    <form className="grid gap-3" onSubmit={form.handleSubmit(async (data) => {
      const result = await savePayerAction(id ?? null, { ...data, active: true });
      if (!result.ok) setError(result.error);
      else router.refresh();
    })}>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Label htmlFor="payer-name">Name</Label><Input id="payer-name" {...form.register("name")} />
      <Label htmlFor="payer-type">Type</Label>
      <select
        id="payer-type"
        className={fieldClass}
        {...typeField}
        onChange={(event) => {
          void typeField.onChange(event);
          if (!id) {
            const defaults = PAYER_TIMEFRAME_DEFAULTS[event.target.value as keyof typeof PAYER_TIMEFRAME_DEFAULTS];
            form.setValue("standardTurnaroundDays", defaults.standardTurnaroundDays);
            form.setValue("expeditedTurnaroundHours", defaults.expeditedTurnaroundHours);
            form.setValue("appealWindowDays", defaults.appealWindowDays);
          }
        }}
      >
        {PAYER_TYPES.map((type) => <option key={type} value={type}>{PAYER_TYPE_LABEL[type]}</option>)}
      </select>
      <Label htmlFor="payer-identifier">Identifier</Label><Input id="payer-identifier" {...form.register("identifier")} />
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label htmlFor="payer-std" className="text-xs">Standard decision (days)</Label>
          <Input id="payer-std" type="number" min={1} {...form.register("standardTurnaroundDays")} />
        </div>
        <div>
          <Label htmlFor="payer-exp" className="text-xs">Expedited (hours)</Label>
          <Input id="payer-exp" type="number" min={1} {...form.register("expeditedTurnaroundHours")} />
        </div>
        <div>
          <Label htmlFor="payer-appeal" className="text-xs">Appeal window (days)</Label>
          <Input id="payer-appeal" type="number" min={1} {...form.register("appealWindowDays")} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Defaults follow the payer type. Confirm them against the payer contract and the rules that apply to it.</p>
      <fieldset className="grid grid-cols-2 gap-1 text-sm">
        <legend className="mb-1 text-sm font-medium">Documents required before submission</legend>
        {DOCUMENT_CATEGORIES.map((category) => (
          <label key={category} className="flex items-center gap-2">
            <input type="checkbox" value={category} {...form.register("requiredDocuments")} />
            {DOCUMENT_CATEGORY_LABEL[category]}
          </label>
        ))}
      </fieldset>
      <Label htmlFor="payer-phone">Phone</Label><Input id="payer-phone" {...form.register("phone")} />
      <Label htmlFor="payer-fax">Fax</Label><Input id="payer-fax" {...form.register("fax")} />
      <Label htmlFor="payer-web">Website</Label><Input id="payer-web" {...form.register("website")} />
      <Label htmlFor="payer-notes">Notes</Label><Textarea id="payer-notes" {...form.register("notes")} />
      <Button type="submit">Save</Button>
    </form>
  );
}
