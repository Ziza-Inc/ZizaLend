import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./[locale]/globals.css";
import { QueryProvider } from "./components/providers/QueryProvider";
import { WalletProvider } from "./components/providers/WalletProvider";
import { DashboardShell } from "./components/global_ui/DashboardShell";
import { Toaster } from "./components/ui/Toaster";
import { LevelUpModal } from "./components/gamification/LevelUpModal";
import { GlobalXPGain } from "./components/global_ui/GlobalXPGain";
import { ErrorBoundary } from "./components/global_ui/ErrorBoundary";
import NetworkBanner from "./components/wallet/NetworkBanner";
import WalletConnectionModal from "./components/wallet/WalletConnectionModal";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { THEME_STORAGE_KEY } from "./lib/theme";
import { buildRootMetadata } from "./lib/metadata";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = buildRootMetadata();

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var root=document.documentElement;var stored=localStorage.getItem("${THEME_STORAGE_KEY}");if(stored==="system"){var resolved=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";root.dataset.theme="system";root.classList.toggle("dark",resolved==="dark");}else if(stored==="dark"||stored==="light"){root.dataset.theme=stored;root.classList.toggle("dark",stored==="dark");}else{var theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";root.dataset.theme=theme;root.classList.toggle("dark",theme==="dark");}}catch(e){}})()`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var map={"ZizaLend-wallet":"Zizalend-wallet","ZizaLend-user":"Zizalend-user","ZizaLend-gamification":"Zizalend-gamification"};var k,v;for(k in map){v=localStorage.getItem(k);if(v!==null&&localStorage.getItem(map[k])===null){localStorage.setItem(map[k],v)}localStorage.removeItem(k)}}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <QueryProvider>
            <WalletProvider>
              <NetworkBanner />
              <DashboardShell>
                <ErrorBoundary scope="active page" variant="section">
                  {children}
                </ErrorBoundary>
              </DashboardShell>
              <WalletConnectionModal />
            </WalletProvider>
            <Toaster />
            <LevelUpModal />
            <GlobalXPGain />
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
