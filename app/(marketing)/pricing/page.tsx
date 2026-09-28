import type { Metadata } from "next";
import Link from "next/link";
import { PLANS } from "@/lib/billing/plans";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <article className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="font-display text-5xl tracking-tight">Straightforward plans</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Prices live in configuration. Stripe checkout is ready to wire when price IDs and a secret key exist. This demo never charges a card.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => (
          <article key={plan.id} className={cn("flex flex-col rounded-xl border bg-card p-5", plan.highlighted && "border-primary")}>
            <h2 className="text-lg font-medium">{plan.name}</h2>
            <p className="font-display mt-3 text-4xl">{plan.priceLabel}{plan.priceMonthly ? <span className="font-sans text-base text-muted-foreground"> / month</span> : null}</p>
            <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <Link href={plan.id === "ENTERPRISE" ? "/contact" : "/signup"} className={cn(buttonVariants({ variant: plan.highlighted ? "default" : "outline" }), "mt-6")}>
              {plan.cta}
            </Link>
          </article>
        ))}
      </div>
    </article>
  );
}
