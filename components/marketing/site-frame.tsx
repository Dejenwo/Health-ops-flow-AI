import { isDemoMode } from "@/lib/config";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { demoLoginAction } from "@/app/actions/auth";
import { cn } from "cn";

const LINKS = [
  { href: "/product", label: "Product" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" aria-label="HealthFlow AI home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex" aria-label="Marketing">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Sign in
          </Link>
          <Link href="/signup" className={cn(buttonVariants({ size: "sm" }), "h-8 px-3")}>
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-3 text-sm text-muted-foreground">Administrative prior authorization workflows. Not a diagnostic device.</p>
        </div>
        {[
          ["Product", [["/product", "Overview"], ["/pricing", "Pricing"], ["/login", "Sign in"]]],
          ["Trust", [["/security", "Security"], ["/contact", "Contact"]]],
        ].map(([title, links]) => (
          <div key={title as string}>
            <p className="text-sm font-medium">{title as string}</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {(links as [string, string][]).map(([href, label]) => (
                <li key={label}>
                  <Link href={href} className="hover:text-foreground">{label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t py-4 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} HealthFlow AI. {isDemoMode() ? "Synthetic demo. Do not enter real patient information." : "Administrative workflow software. Not a medical device."}</div>
    </footer>
  );
}

export function DemoButton({ className, label = "View demo" }: { className?: string; label?: string }) {
  // The shared synthetic clinic exists only in demo mode. Production deployments route to a demo request.
  if (!isDemoMode()) {
    return (
      <Link href="/contact" className={className}>
        Request a demo
      </Link>
    );
  }
  return (
    <form action={demoLoginAction}>
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}
