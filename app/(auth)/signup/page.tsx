"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpAction } from "@/app/actions/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignUpPage() {
  const [state, action, pending] = useActionState(signUpAction, null);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Link href="/"><Logo /></Link>
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Create your organization</h1>
      <p className="mt-1 text-sm text-muted-foreground">You will be the owner. Use synthetic information only.</p>
      <form action={action} className="mt-6 space-y-4">
        {state && !state.ok ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>{pending ? "Creating…" : "Start free"}</Button>
      </form>
      <p className="mt-6 text-sm">Already have an account? <Link href="/login" className="text-primary">Sign in</Link></p>
    </main>
  );
}
