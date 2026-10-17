import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ALLINONEVIEW",
    short_name: "ALLINONEVIEW",
    description: "Read-only real-time multi-market analysis platform",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#080b10",
    theme_color: "#080b10",
    categories: ["finance", "business", "productivity"],
    icons: [
      {
        src: "/api/app-icon?size=192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/api/app-icon?size=512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/api/app-icon?size=512&maskable=1",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
