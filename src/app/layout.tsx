import type { Metadata, Viewport } from "next";
import PwaRegister from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "ALLINONEVIEW",
  description: "Read-only real-time multi-market analysis platform",
  applicationName: "ALLINONEVIEW",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ALLINONEVIEW"
  },
  icons: {
    icon: [
      {
        url: "/api/app-icon?size=192",
        sizes: "192x192",
        type: "image/png"
      },
      {
        url: "/api/app-icon?size=512",
        sizes: "512x512",
        type: "image/png"
      }
    ],
    apple: [
      {
        url: "/api/app-icon?size=180",
        sizes: "180x180",
        type: "image/png"
      }
    ]
  },
  robots: {
    index: false,
    follow: false
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#080b10"
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
        {children}
      </body>
    </html>
  );
}
