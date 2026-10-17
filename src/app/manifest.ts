import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ALLINONEVIEW",
    short_name: "ALLINONEVIEW",
    description:
      "Read-only multi-market analysis with live charts, structure, Fibonacci, derivatives confirmation and reversal scoring.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#080c12",
    theme_color: "#080c12",
    categories: ["finance", "business", "productivity"],
    icons: [
      {
        src: "/allinoneview-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/allinoneview-icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable"
      }
    ]
  };
}
