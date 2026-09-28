import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const newsreader = localFont({
  src: [
    { path: "./fonts/newsreader-latin-wght-normal.woff2", style: "normal" },
    { path: "./fonts/newsreader-latin-wght-italic.woff2", style: "italic" },
  ],
  variable: "--font-newsreader",
  weight: "200 800",
});

export const metadata: Metadata = {
  title: {
    default: "HealthFlow AI",
    template: "%s · HealthFlow AI",
  },
  description: "Prior authorization workflows, powered by AI. Organize cases, documents, tasks, and payer follow-ups.",
};

/**
 * Reading the request headers makes every page render per request, which is what lets Next.js
 * stamp the proxy's CSP nonce onto its scripts (see proxy.ts).
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        <ThemeProvider nonce={nonce}>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
