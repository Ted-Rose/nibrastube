import type { Metadata, Viewport } from "next"
import { Geist_Mono, Instrument_Sans } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { PwaRegister } from "@/components/pwa-register"
import { AppUpdateBanner } from "@/components/app-update-banner"
import { DragScroll } from "@/components/drag-scroll"
import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"
import { cn } from "@/lib/utils";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  applicationName: "NibrasTube",
  // Chrome's page translator wraps text nodes in <font> elements, which
  // crashes React reconciliation (insertBefore/removeChild
  // NotFoundError → "Rendered more hooks" → global error page). Opt
  // the whole app out — every interactive text update is at risk.
  other: { google: "notranslate" },
  title: {
    default: "NibrasTube",
    template: "%s | NibrasTube",
  },
  description:
    "Safe videos, parent approved. Choose exactly what your kids can watch.",
  appleWebApp: {
    capable: true,
    title: "NibrasTube",
    statusBarStyle: "default",
  },
}

export const viewport: Viewport = {
  themeColor: "#ca3500",
  // Let PWA/Capacitor content extend under the notch — edge elements pad
  // themselves with env(safe-area-inset-*).
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      translate="no"
      suppressHydrationWarning
      className={cn(
        "notranslate",
        "antialiased",
        fontMono.variable,
        "font-sans",
        instrumentSans.variable
      )}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <PwaRegister />
        <AppUpdateBanner />
        <DragScroll />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
