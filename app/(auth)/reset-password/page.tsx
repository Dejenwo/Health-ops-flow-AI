"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { resetPasswordAction } from "@/app/actions/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function ResetForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={params.get("token") ?? ""} />
      {state && !state.ok ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" minLength={12} required autoComplete="new-password" />
      </div>
      <Button type="submit" disabled={pending}>Update password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Link href="/"><Logo /></Link>
      <h1 className="mt-8 text-2xl font-semibold">Choose a new password</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </main>
  );
}
