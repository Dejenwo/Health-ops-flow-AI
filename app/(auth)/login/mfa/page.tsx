import Link from "next/link";
import { Suspense } from "react";
import { MfaForm } from "@/components/auth/login-form";
import { Logo } from "@/components/brand/logo";

export const metadata = { title: "Two-factor sign-in" };

export default function MfaPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Link href="/"><Logo /></Link>
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Two-factor sign-in</h1>
      <div className="mt-6">
        <Suspense>
          <MfaForm />
        </Suspense>
      </div>
      <p className="mt-6 text-sm"><Link href="/login" className="text-primary">Start over</Link></p>
    </main>
  );
}
