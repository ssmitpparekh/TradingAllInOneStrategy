import type { Metadata, Viewport } from "next";
import PwaRegister from "@/components/PwaRegister";
import AppNavigation from "@/components/AppNavigation";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ALLINONEVIEW",
    template: "%s · ALLINONEVIEW"
  },
  applicationName: "ALLINONEVIEW",
  description: "Read-only real-time multi-market analysis platform",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/allinoneview-icon.svg",
        type: "image/svg+xml"
      }
    ],
    apple: [
      {
        url: "/allinoneview-icon.svg",
        type: "image/svg+xml"
      }
    ]
  },
  appleWebApp: {
    capable: true,
    title: "ALLINONEVIEW",
    statusBarStyle: "black-translucent"
  },
  formatDetection: {
    telephone: false
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#080c12",
  colorScheme: "dark"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <PwaRegister />
        <AppNavigation />
        {children}
      </body>
    </html>
  );
}
