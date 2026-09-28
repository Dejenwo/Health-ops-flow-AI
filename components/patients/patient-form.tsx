"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { savePatientAction } from "@/app/actions/records";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldClass } from "@/components/page-header";
import { patientSchema } from "@/lib/domain/schemas";
import { SEX_VALUES } from "@/lib/domain/types";
import { SEX_LABEL } from "@/lib/domain/labels";
import type { z } from "zod";

type Values = z.infer<typeof patientSchema>;

export function PatientForm({ id, values, payers }: { id?: string; values?: Partial<Values>; payers: { id: string; name: string }[] }) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      mrn: "",
      firstName: "",
      lastName: "",
      dateOfBirth: "",
      sex: "UNKNOWN",
      phone: "",
      email: "",
      address: "",
      city: "",
      state: "",
      zip: "",
      primaryPayerId: "",
      memberId: "",
      groupNumber: "",
      ...values,
    },
  });

  return (
    <form
      className="grid gap-4 md:grid-cols-2"
      onSubmit={form.handleSubmit(async (data) => {
        setError(null);
        const result = await savePatientAction(id ?? null, data);
        if (result && !result.ok) setError(result.error);
      }, () => setError("Check the required fields and try again."))}
    >
      {error ? <p className="text-sm text-destructive md:col-span-2" role="alert">{error}</p> : null}
      {[
        ["mrn", "MRN"],
        ["firstName", "First name"],
        ["lastName", "Last name"],
        ["phone", "Phone"],
        ["email", "Email"],
        ["address", "Address"],
        ["city", "City"],
        ["state", "State"],
        ["zip", "ZIP"],
        ["memberId", "Member ID"],
        ["groupNumber", "Group number"],
      ].map(([name, label]) => (
        <div key={name} className="space-y-1.5">
          <Label htmlFor={name}>{label}</Label>
          <Input id={name} type={name === "email" ? "email" : "text"} {...form.register(name as keyof Values)} />
        </div>
      ))}
      <div className="space-y-1.5">
        <Label htmlFor="dateOfBirth">Date of birth</Label>
        <Input id="dateOfBirth" type="date" {...form.register("dateOfBirth")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sex">Sex</Label>
        <select id="sex" className={fieldClass} {...form.register("sex")}>
          {SEX_VALUES.map((sex) => <option key={sex} value={sex}>{SEX_LABEL[sex]}</option>)}
        </select>
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="primaryPayerId">Primary payer</Label>
        <select id="primaryPayerId" className={fieldClass} {...form.register("primaryPayerId")}>
          <option value="">None</option>
          {payers.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}
        </select>
      </div>
      <div className="md:col-span-2">
        <Button type="submit" disabled={form.formState.isSubmitting}>{id ? "Save patient" : "Create patient"}</Button>
      </div>
    </form>
  );
}
