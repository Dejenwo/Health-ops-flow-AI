import Link from "next/link";

const LINKS = [
  ["/settings", "Organization"],
  ["/settings/profile", "Profile"],
  ["/settings/notifications", "Notifications"],
  ["/settings/security", "Security"],
  ["/settings/billing", "Billing"],
  ["/settings/api", "API"],
  ["/settings/audit", "Audit log"],
  ["/settings/roles", "Roles & permissions"],
  ["/team", "Team"],
  ["/integrations", "Integrations"],
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav className="flex gap-2 overflow-x-auto text-sm lg:flex-col" aria-label="Settings">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className="rounded-lg px-2 py-1.5 hover:bg-muted">{label}</Link>
        ))}
      </nav>
      <div>{children}</div>
    </div>
  );
}
