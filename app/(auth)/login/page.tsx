import Link from "next/link";
import { Suspense } from "react";
import { demoLoginAction } from "@/app/actions/auth";
import { LoginForm, SsoEntry } from "@/components/auth/login-form";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { isDemoMode } from "@/lib/config";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/demo/accounts";
import { cn } from "cn";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  const demo = isDemoMode();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Link href="/"><Logo /></Link>
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {demo ? "Use your organization account, or open the synthetic clinic." : "Use your organization account."}
      </p>
      <div className="mt-6">
        <Suspense>
          <LoginForm />
        </Suspense>
        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>
        <Suspense>
          <SsoEntry />
        </Suspense>
      </div>
      {demo ? (
        <>
          <form action={demoLoginAction} className="mt-3">
            <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>View demo as Northstar owner</button>
          </form>
          <div className="mt-6 rounded-xl border bg-card p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Synthetic accounts · password {DEMO_PASSWORD}</p>
            <ul className="mt-2 space-y-1">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email}>{account.email} · {account.role}</li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
      <p className="mt-6 text-sm">No account? <Link href="/signup" className="text-primary">Start free</Link></p>
    </main>
  );
}
