"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPasswordAction } from "@/app/actions/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(forgotPasswordAction, null);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Link href="/"><Logo /></Link>
      <h1 className="mt-8 text-2xl font-semibold">Reset password</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enter your account email. If it is registered, we will send a link that works for 30 minutes.</p>
      <form action={action} className="mt-6 space-y-4">
        {state && !state.ok ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
        {state?.ok ? (
          <p className="text-sm" role="status">
            If that email is registered, a reset link is on its way.
            {state.data?.resetPath ? (
              <>
                {" "}
                Demo mode has no email, so here it is: <Link className="text-primary" href={state.data.resetPath}>open the reset link</Link>.
              </>
            ) : null}
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <Button type="submit" disabled={pending}>Send reset link</Button>
      </form>
    </main>
  );
}
