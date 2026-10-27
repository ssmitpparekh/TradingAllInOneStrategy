"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Chart", icon: "◫" },
  { href: "/market-pulse", label: "Market Pulse", icon: "♥" },
  { href: "/sector-scope", label: "Sector Scope", icon: "▦" },
  { href: "/swing-spectrum", label: "Swing Spectrum", icon: "⌁" },
  { href: "/index-mover", label: "Index Mover", icon: "↗" },
  { href: "/option-clock", label: "Option Clock", icon: "◷" },
  { href: "/option-apex", label: "Option Apex", icon: "◉" },
  { href: "/fii-dii", label: "FII / DII", icon: "₹" },
  { href: "/crypto-signals", label: "Crypto Signals", icon: "₿" },
  { href: "/trades", label: "Trading Journal", icon: "▤" },
  { href: "/watchlist", label: "Watchlist", icon: "☆" },
  { href: "/calculator", label: "Calculator", icon: "÷" }
];

export default function AppNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        className="appNavTrigger"
        type="button"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span />
        <span />
        <span />
      </button>

      {open ? (
        <button
          className="appNavBackdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside className={open ? "appNavDrawer open" : "appNavDrawer"}>
        <div className="appNavHeader">
          <div>
            <small>ALLINONEVIEW</small>
            <strong>Markets</strong>
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>

        <nav>
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={pathname === item.href ? "active" : ""}
            >
              <span className="appNavIcon">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="appNavFooter">
          <small>Provider-aware analytics</small>
          <span>FYERS · OANDA · KRAKEN</span>
        </div>
      </aside>
    </>
  );
}
