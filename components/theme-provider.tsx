"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange nonce={nonce}>
      {children}
    </NextThemesProvider>
  );
}
