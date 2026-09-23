"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { createWagmiConfig, getAppKit } from "@/lib/wagmi";
import { WalletNetworkProvider } from "@/hooks/useVerifiedWalletChain";
import { PreferenceProvider, usePreferences } from "@/hooks/usePreferences";
import type { Locale, ThemePreference } from "@/i18n";
import { AppLockProvider } from "@/hooks/useAppLock";
import { AppLockGate } from "@/components/AppLockGate";
import { LocalWalletProvider } from "@/hooks/useWalletAccount";

export function Providers({ children, initialLocale, initialTheme }: { children: ReactNode; initialLocale: Locale; initialTheme: ThemePreference }) {
  const [queryClient] = useState(() => new QueryClient());
  const [wagmiConfig] = useState(createWagmiConfig);

  return (
    <PreferenceProvider initialLocale={initialLocale} initialTheme={initialTheme}>
      <AppKitThemeSync />
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <AppLockProvider><AppLockGate><LocalWalletProvider><WalletNetworkProvider>{children}</WalletNetworkProvider></LocalWalletProvider></AppLockGate></AppLockProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </PreferenceProvider>
  );
}

function AppKitThemeSync() {
  const { theme } = usePreferences();
  useEffect(() => {
    const appKit = getAppKit();
    if (!appKit) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => appKit.setThemeMode(theme === "system" ? (media.matches ? "dark" : "light") : theme);
    sync();
    if (theme !== "system") return;
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);
  return null;
}
