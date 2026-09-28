"use client";

import { useActionState } from "react";
import { contactAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function ContactPage() {
  const [state, action, pending] = useActionState(contactAction, null);
  return (
    <article className="mx-auto max-w-xl px-4 py-16">
      <h1 className="font-display text-5xl tracking-tight">Contact</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This demo stores the message locally. It does not send email.
      </p>
      {state?.ok ? (
        <p className="mt-6 rounded-lg border bg-card p-4 text-sm" role="status">Message saved in the demo store. Nothing was emailed.</p>
      ) : (
        <form action={action} className="mt-8 space-y-4">
          {state && !state.ok ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
          <Field label="Name" name="name" />
          <Field label="Work email" name="email" type="email" />
          <Field label="Organization" name="organization" />
          <div className="space-y-1.5">
            <Label htmlFor="message">How can we help?</Label>
            <Textarea id="message" name="message" required minLength={10} rows={5} />
          </div>
          <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send message"}</Button>
        </form>
      )}
    </article>
  );
}

function Field({ label, name, type = "text" }: { label: string; name: string; type?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} required />
    </div>
  );
}
