import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono, Instrument_Sans } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { PwaRegister } from "@/components/pwa-register"
import { cn } from "@/lib/utils";

const instrumentSans = Instrument_Sans({subsets:['latin'],variable:'--font-sans'})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  applicationName: "NibrasTube",
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
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", instrumentSans.variable)}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <PwaRegister />
      </body>
    </html>
  )
}
