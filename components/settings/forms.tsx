"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { organizationAction, planAction, profileAction, notificationPrefsAction } from "@/app/actions/admin";
import { changePasswordAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldClass } from "@/components/page-header";
import { organizationSettingsSchema, profileSchema } from "@/lib/domain/schemas";
import { ORG_TYPES, type NotificationPreferences, type OrgType, type PlanId } from "@/lib/domain/types";
import { ORG_TYPE_LABEL } from "@/lib/domain/labels";
import { PLANS } from "@/lib/billing/plans";
import type { z } from "zod";

export function ProfileForm({ values }: { values: z.infer<typeof profileSchema> }) {
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(profileSchema), defaultValues: values });
  return (
    <form className="max-w-lg space-y-3" onSubmit={form.handleSubmit(async (data) => {
      const result = await profileAction(data);
      setMessage(result.ok ? "Profile saved." : result.error);
    })}>
      {message ? <p className="text-sm">{message}</p> : null}
      <Label>Full name</Label><Input {...form.register("fullName")} />
      <Label>Job title</Label><Input {...form.register("jobTitle")} />
      <Label>Phone</Label><Input {...form.register("phone")} />
      <Button type="submit">Save profile</Button>
    </form>
  );
}

export function OrganizationForm({ values, disabled }: { values: { name: string; type: OrgType; specialty: string; providerCount: number }; disabled?: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(organizationSettingsSchema), defaultValues: values });
  return (
    <form className="max-w-lg space-y-3" onSubmit={form.handleSubmit(async (data) => {
      const result = await organizationAction(data);
      setMessage(result.ok ? "Organization saved." : result.error);
    })}>
      {message ? <p className="text-sm">{message}</p> : null}
      <Label>Name</Label><Input disabled={disabled} {...form.register("name")} />
      <select className={fieldClass} disabled={disabled} {...form.register("type")}>
        {ORG_TYPES.map((type) => <option key={type} value={type}>{ORG_TYPE_LABEL[type]}</option>)}
      </select>
      <Label>Specialty</Label><Input disabled={disabled} {...form.register("specialty")} />
      <Label>Provider count</Label><Input disabled={disabled} type="number" {...form.register("providerCount")} />
      {disabled ? <p className="text-xs text-muted-foreground">Your role cannot edit the organization.</p> : <Button type="submit">Save organization</Button>}
    </form>
  );
}

export function NotificationForm({ values }: { values: NotificationPreferences }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form className="space-y-3 text-sm" onSubmit={async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const result = await notificationPrefsAction({
        caseAssigned: form.get("caseAssigned") === "on",
        statusChanged: form.get("statusChanged") === "on",
        taskDue: form.get("taskDue") === "on",
        aiComplete: form.get("aiComplete") === "on",
        emailEnabled: form.get("emailEnabled") === "on",
      });
      setMessage(result.ok ? "Preferences saved. Email delivery is not configured." : result.error);
    }}>
      {message ? <p>{message}</p> : null}
      <label className="flex gap-2"><input type="checkbox" name="caseAssigned" defaultChecked={values.caseAssigned} /> Case assigned</label>
      <label className="flex gap-2"><input type="checkbox" name="statusChanged" defaultChecked={values.statusChanged} /> Status changed</label>
      <label className="flex gap-2"><input type="checkbox" name="taskDue" defaultChecked={values.taskDue} /> Task due</label>
      <label className="flex gap-2"><input type="checkbox" name="aiComplete" defaultChecked={values.aiComplete} /> AI analysis complete</label>
      <label className="flex gap-2"><input type="checkbox" name="emailEnabled" defaultChecked={values.emailEnabled} /> Email when delivery is configured</label>
      <Button type="submit">Save preferences</Button>
    </form>
  );
}

export function PasswordForm() {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form className="max-w-lg space-y-3" action={async (formData) => {
      const result = await changePasswordAction(null, formData);
      setMessage(result.ok ? "Password updated. Your other sessions were signed out." : result.error);
    }}>
      {message ? <p className="text-sm">{message}</p> : null}
      <Label htmlFor="currentPassword">Current password</Label>
      <Input id="currentPassword" name="currentPassword" type="password" required />
      <Label htmlFor="nextPassword">New password</Label>
      <Input id="nextPassword" name="nextPassword" type="password" minLength={12} required />
      <Button type="submit">Update password</Button>
    </form>
  );
}

export function PlanPicker({ current }: { current: PlanId }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {PLANS.map((plan) => (
        <article key={plan.id} className="rounded-xl border p-4">
          <h3 className="font-medium">{plan.name}</h3>
          <p className="text-sm text-muted-foreground">{plan.priceLabel}</p>
          <Button
            className="mt-3"
            variant={plan.id === current ? "secondary" : "outline"}
            disabled={plan.id === current}
            onClick={() => {
              void planAction({ plan: plan.id }).then((result) => setMessage(result.ok ? `Demo plan set to ${plan.name}. No card was charged.` : result.error));
            }}
          >
            {plan.id === current ? "Current plan" : "Use in demo"}
          </Button>
        </article>
      ))}
      {message ? <p className="text-sm md:col-span-3">{message}</p> : null}
    </div>
  );
}
