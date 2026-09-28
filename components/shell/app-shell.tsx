"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  BarChart3,
  Bell,
  Building2,
  CheckSquare,
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeft,
  Plug,
  Plus,
  Search,
  Settings,
  Sparkles,
  Stethoscope,
  Sun,
  Users,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Logo } from "@/components/brand/logo";
import { SearchDialog } from "@/components/shell/search-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { markAllReadAction, markReadAction } from "@/app/actions/workflow";
import { signOutAction, switchOrgAction } from "@/app/actions/auth";
import type { AppNotification, Role } from "@/lib/domain/types";
import { ROLE_LABEL } from "@/lib/domain/labels";
import { formatRelative, initials } from "@/lib/format";
import { cn } from "cn";

function readFlag(storage: "local" | "session", key: string, expected: string) {
  if (typeof window === "undefined") return false;
  const box = storage === "local" ? localStorage : sessionStorage;
  return box.getItem(key) === expected;
}

function subscribeStorage(onChange: () => void) {
  window.addEventListener("hf-storage", onChange);
  return () => window.removeEventListener("hf-storage", onChange);
}

function writeFlag(storage: "local" | "session", key: string, value: string) {
  const box = storage === "local" ? localStorage : sessionStorage;
  box.setItem(key, value);
  window.dispatchEvent(new Event("hf-storage"));
}

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/authorizations", label: "Authorizations", icon: ClipboardList },
  { href: "/patients", label: "Patients", icon: Users },
  { href: "/providers", label: "Providers", icon: Stethoscope },
  { href: "/payers", label: "Payers", icon: Building2 },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/documents", label: "Documents", icon: FolderOpen },
  { href: "/ai-assistant", label: "AI Assistant", icon: Sparkles },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export interface ShellMembership {
  organizationId: string;
  name: string;
  role: Role;
  synthetic: boolean;
}

export function AppShell({
  children,
  user,
  organization,
  memberships,
  notifications,
}: {
  children: React.ReactNode;
  user: { name: string; email: string; role: Role };
  organization: { id: string; name: string; synthetic: boolean };
  memberships: ShellMembership[];
  notifications: AppNotification[];
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    subscribeStorage,
    () => readFlag("local", "hf-sidebar", "collapsed"),
    () => false,
  );
  const bannerHidden = useSyncExternalStore(
    subscribeStorage,
    () => readFlag("session", "hf-banner", "hidden"),
    () => false,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    rootRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleCollapsed() {
    writeFlag("local", "hf-sidebar", collapsed ? "open" : "collapsed");
  }

  const unread = notifications.filter((item) => !item.readAt).length;

  return (
    <div ref={rootRef} className="min-h-screen bg-background" data-hydrated="false">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="hidden md:fixed md:inset-y-0 md:z-30 md:flex">
        <Sidebar pathname={pathname} collapsed={collapsed} />
      </div>
      <div className={cn("flex min-h-screen flex-col transition-[padding] md:pl-64", collapsed && "md:pl-[72px]")}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:px-5">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          <Button variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Collapse sidebar" onClick={toggleCollapsed}>
            <PanelLeft />
          </Button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-8 max-w-md flex-1 items-center gap-2 rounded-lg border bg-card px-2.5 text-left text-sm text-muted-foreground"
          >
            <Search className="size-4" />
            <span className="flex-1">Search patients, authorizations, tasks</span>
            <kbd className="hidden rounded border px-1.5 text-[10px] sm:inline">⌘K</kbd>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Plus /> <span className="hidden sm:inline">Quick create</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem render={<Link href="/authorizations/new" />}>New authorization</DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/patients/new" />}>New patient</DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/tasks" />}>New task</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <NotificationMenu notifications={notifications} unread={unread} />
          <DropdownMenu>
            <DropdownMenuTrigger className="hidden max-w-48 truncate rounded-lg border px-2.5 py-1.5 text-left text-sm sm:block">
              {organization.name}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Organization</DropdownMenuLabel>
              {memberships.map((membership) => (
                <DropdownMenuItem key={membership.organizationId} onClick={() => {
                  const form = new FormData();
                  form.set("organizationId", membership.organizationId);
                  void switchOrgAction(form);
                }}>
                  {membership.name}
                  {membership.organizationId === organization.id ? " · current" : ""}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <UserMenu user={user} />
        </header>
        {organization.synthetic && !bannerHidden ? (
          <div className="flex items-center justify-between gap-3 border-b bg-amber-50 px-4 py-2 text-xs text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
            <p>Synthetic demo data for {organization.name}. Do not enter real patient information.</p>
            <button
              type="button"
              className="underline"
              onClick={() => writeFlag("session", "hf-banner", "hidden")}
            >
              Dismiss
            </button>
          </div>
        ) : null}
        <main id="main" className="flex-1 px-4 py-6 md:px-6">
          {children}
        </main>
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <Sidebar pathname={pathname} collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function Sidebar({ pathname, collapsed, onNavigate }: { pathname: string; collapsed: boolean; onNavigate?: () => void }) {
  return (
    <aside className={cn("flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200", collapsed && "w-[72px]")}>
      <div className={cn("flex h-14 items-center border-b border-sidebar-border px-3 text-white", collapsed && "justify-center px-0")}>
        <Link href="/dashboard" aria-label="HealthFlow AI home">
          <Logo wordmark={!collapsed} />
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Primary">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={item.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring",
                active &&
                  "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-sidebar-primary",
                collapsed && "justify-center px-0",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active && "text-sidebar-primary")} aria-hidden />
              {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function NotificationMenu({ notifications, unread }: { notifications: AppNotification[]; unread: number }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} />}>
        <Bell />
        {unread ? <span className="absolute top-1 right-1 size-2 rounded-full bg-primary" /> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          Notifications
          {unread ? (
            <button type="button" className="text-xs font-normal text-primary" onClick={() => void markAllReadAction().then(() => router.refresh())}>
              Mark all read
            </button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">You are caught up.</p> : null}
        {notifications.slice(0, 8).map((item) => (
          <DropdownMenuItem
            key={item.id}
            className="items-start"
            onClick={() => {
              void markReadAction(item.id);
              if (item.href) router.push(item.href);
            }}
          >
            <span className="block">
              <span className={cn("block text-sm", !item.readAt && "font-medium")}>{item.title}</span>
              <span className="block text-xs text-muted-foreground">{item.body}</span>
              <span className="block text-[11px] text-muted-foreground">{formatRelative(item.createdAt)}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user }: { user: { name: string; email: string; role: Role } }) {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="grid size-8 place-items-center rounded-full bg-primary text-xs font-medium text-primary-foreground" aria-label="Account menu">
        {initials(user.name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block">{user.name}</span>
          <span className="block text-xs font-normal text-muted-foreground">{user.email}</span>
          <span className="block text-xs font-normal text-muted-foreground">{ROLE_LABEL[user.role]}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings/profile" />}>Profile</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun /> : <Moon />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOutAction()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
