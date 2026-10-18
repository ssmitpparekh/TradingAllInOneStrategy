"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  summarizeTrades,
  type JournalTrade
} from "@/lib/analysis/trade-journal";

const PLATFORM_JOURNAL_KEY = "allinoneview:trade-journal:v1";
const THEME_KEY = "allinoneview:theme:v1";

type ManualTrade = {
  id: string;
  tradeTime: number;
  market: string;
  instrumentType: string;
  symbol: string;
  name: string;
  side: "BUY" | "SELL";
  status: "OPEN" | "CLOSED";
  quantity: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  exitPrice: number | null;
  amountIn: number | null;
  fees: number;
  profitLoss: number | null;
  currency: string;
  expiry: string | null;
  strike: number | null;
  optionType: "CE" | "PE" | "CALL" | "PUT" | null;
  setup: string;
  notes: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ManualTradeForm = {
  id?: string;
  dateTime: string;
  market: string;
  instrumentType: string;
  symbol: string;
  name: string;
  side: "BUY" | "SELL";
  status: "OPEN" | "CLOSED";
  quantity: string;
  entryPrice: string;
  stopLoss: string;
  targetPrice: string;
  exitPrice: string;
  amountIn: string;
  fees: string;
  profitLoss: string;
  currency: string;
  expiry: string;
  strike: string;
  optionType: "" | "CE" | "PE" | "CALL" | "PUT";
  setup: string;
  notes: string;
};

type RangeFilter = "TODAY" | "7D" | "30D" | "ALL";
type ViewMode = "MANUAL" | "PLATFORM";

const RANGE_FILTERS: Array<{ value: RangeFilter; label: string }> = [
  { value: "TODAY", label: "TODAY" },
  { value: "7D", label: "7 DAYS" },
  { value: "30D", label: "30 DAYS" },
  { value: "ALL", label: "ALL TIME" }
];

const MARKET_OPTIONS = [
  "NSE",
  "BSE",
  "MCX",
  "OANDA",
  "KRAKEN",
  "OTHER"
];

const INSTRUMENT_TYPES = [
  "STOCK",
  "INDEX",
  "OPTION",
  "FUTURE",
  "FOREX",
  "CRYPTO",
  "COMMODITY",
  "ETF",
  "OTHER"
];

const CURRENCIES = ["INR", "USD", "CAD", "GBP", "EUR"];

function localDateTimeValue(epochSeconds = Date.now() / 1000) {
  const date = new Date(epochSeconds * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes())
  ].join("");
}

function blankForm(): ManualTradeForm {
  return {
    dateTime: localDateTimeValue(),
    market: "NSE",
    instrumentType: "STOCK",
    symbol: "",
    name: "",
    side: "BUY",
    status: "OPEN",
    quantity: "",
    entryPrice: "",
    stopLoss: "",
    targetPrice: "",
    exitPrice: "",
    amountIn: "",
    fees: "0",
    profitLoss: "",
    currency: "INR",
    expiry: "",
    strike: "",
    optionType: "",
    setup: "",
    notes: ""
  };
}

function inputNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-IN", {
      maximumFractionDigits: 2
    })}`;
  }
}

function formatNumber(value: number | null) {
  if (value === null) return "—";
  return value.toLocaleString("en-IN", {
    maximumFractionDigits: 2
  });
}

function inRange(epoch: number, range: RangeFilter) {
  if (range === "ALL") return true;
  const now = Date.now() / 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (range === "TODAY") return epoch >= today.getTime() / 1000;
  const days = range === "7D" ? 7 : 30;
  return epoch >= now - days * 86400;
}

function manualPnlPreview(form: ManualTradeForm) {
  const manual = inputNumber(form.profitLoss);
  if (manual !== null) return manual;
  if (form.status !== "CLOSED") return null;

  const qty = inputNumber(form.quantity);
  const entry = inputNumber(form.entryPrice);
  const exit = inputNumber(form.exitPrice);
  const fees = inputNumber(form.fees) ?? 0;
  if (qty === null || entry === null || exit === null) return null;

  const raw =
    form.side === "BUY"
      ? (exit - entry) * qty
      : (entry - exit) * qty;
  return raw - fees;
}

function riskRewardPreview(form: ManualTradeForm) {
  const entry = inputNumber(form.entryPrice);
  const stop = inputNumber(form.stopLoss);
  const target = inputNumber(form.targetPrice);
  if (entry === null || stop === null || target === null) return null;

  const risk =
    form.side === "BUY" ? entry - stop : stop - entry;
  const reward =
    form.side === "BUY" ? target - entry : entry - target;

  if (!(risk > 0) || !(reward > 0)) return null;
  return reward / risk;
}

function formFromTrade(trade: ManualTrade): ManualTradeForm {
  return {
    id: trade.id,
    dateTime: localDateTimeValue(trade.tradeTime),
    market: trade.market,
    instrumentType: trade.instrumentType,
    symbol: trade.symbol,
    name: trade.name,
    side: trade.side,
    status: trade.status,
    quantity: trade.quantity?.toString() ?? "",
    entryPrice: trade.entryPrice?.toString() ?? "",
    stopLoss: trade.stopLoss?.toString() ?? "",
    targetPrice: trade.targetPrice?.toString() ?? "",
    exitPrice: trade.exitPrice?.toString() ?? "",
    amountIn: trade.amountIn?.toString() ?? "",
    fees: trade.fees?.toString() ?? "0",
    profitLoss: trade.profitLoss?.toString() ?? "",
    currency: trade.currency,
    expiry: trade.expiry ?? "",
    strike: trade.strike?.toString() ?? "",
    optionType: trade.optionType ?? "",
    setup: trade.setup,
    notes: trade.notes
  };
}

export default function TradesPage() {
  const [manualTrades, setManualTrades] = useState<ManualTrade[]>([]);
  const [platformTrades, setPlatformTrades] = useState<JournalTrade[]>([]);
  const [view, setView] = useState<ViewMode>("MANUAL");
  const [range, setRange] = useState<RangeFilter>("ALL");
  const [market, setMarket] = useState("ALL");
  const [currency, setCurrency] = useState("ALL");
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ManualTradeForm>(blankForm());
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const loadManualTrades = async () => {
    try {
      const response = await fetch("/api/journal/trades", {
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to load journal.");
      }
      setManualTrades(Array.isArray(data.trades) ? data.trades : []);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load journal."
      );
    }
  };

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(THEME_KEY);
      const theme =
        savedTheme === "light" || savedTheme === "dark"
          ? savedTheme
          : window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark";
      document.documentElement.dataset.theme = theme;
    } catch {
      // Keep current theme.
    }

    try {
      const raw = window.localStorage.getItem(PLATFORM_JOURNAL_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setPlatformTrades(Array.isArray(parsed) ? parsed : []);
    } catch {
      setPlatformTrades([]);
    }

    void loadManualTrades();
  }, []);

  const manualFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return manualTrades
      .filter((trade) => market === "ALL" || trade.market === market)
      .filter((trade) => currency === "ALL" || trade.currency === currency)
      .filter((trade) => inRange(trade.tradeTime, range))
      .filter((trade) => {
        if (!q) return true;
        return (
          trade.symbol.toLowerCase().includes(q) ||
          trade.name.toLowerCase().includes(q) ||
          trade.setup.toLowerCase().includes(q) ||
          trade.notes.toLowerCase().includes(q)
        );
      })
      .slice()
      .sort((a, b) => b.tradeTime - a.tradeTime);
  }, [manualTrades, market, currency, range, query]);

  const currencyTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const trade of manualFiltered) {
      if (trade.profitLoss === null) continue;
      totals.set(
        trade.currency,
        (totals.get(trade.currency) ?? 0) + trade.profitLoss
      );
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [manualFiltered]);

  const manualStats = useMemo(() => {
    const closed = manualFiltered.filter(
      (trade) => trade.status === "CLOSED"
    );
    const pnlTrades = closed.filter((trade) => trade.profitLoss !== null);
    const wins = pnlTrades.filter((trade) => (trade.profitLoss ?? 0) > 0);
    const losses = pnlTrades.filter((trade) => (trade.profitLoss ?? 0) < 0);
    return {
      total: manualFiltered.length,
      closed: closed.length,
      open: manualFiltered.filter((trade) => trade.status === "OPEN").length,
      winRate: pnlTrades.length ? (wins.length / pnlTrades.length) * 100 : 0,
      biggestWin: wins.length
        ? Math.max(...wins.map((trade) => trade.profitLoss ?? 0))
        : null,
      biggestLoss: losses.length
        ? Math.min(...losses.map((trade) => trade.profitLoss ?? 0))
        : null
    };
  }, [manualFiltered]);

  const accumulatedById = useMemo(() => {
    const running = new Map<string, number>();
    const byId = new Map<string, number>();
    const ordered = manualTrades.slice().sort((a, b) => a.tradeTime - b.tradeTime);

    for (const trade of ordered) {
      const next =
        (running.get(trade.currency) ?? 0) + (trade.profitLoss ?? 0);
      running.set(trade.currency, next);
      byId.set(trade.id, next);
    }
    return byId;
  }, [manualTrades]);

  const monthHeatmap = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const first = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();
    const prefix = (first.getDay() + 6) % 7;
    const pnlByDay = new Map<number, number>();

    for (const trade of manualTrades) {
      const date = new Date(trade.tradeTime * 1000);
      if (date.getFullYear() !== year || date.getMonth() !== month) continue;
      pnlByDay.set(
        date.getDate(),
        (pnlByDay.get(date.getDate()) ?? 0) + (trade.profitLoss ?? 0)
      );
    }

    return {
      label: now.toLocaleString("en-US", {
        month: "long",
        year: "numeric"
      }),
      cells: [
        ...Array.from({ length: prefix }, () => null),
        ...Array.from({ length: days }, (_, index) => {
          const day = index + 1;
          return { day, pnl: pnlByDay.get(day) ?? 0 };
        })
      ]
    };
  }, [manualTrades]);

  const pnlPreview = manualPnlPreview(form);
  const rrPreview = riskRewardPreview(form);

  const updateForm = <K extends keyof ManualTradeForm,>(
    key: K,
    value: ManualTradeForm[K]
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const openNew = () => {
    setForm(blankForm());
    setFormOpen(true);
    setMessage("");
  };

  const openEdit = (trade: ManualTrade) => {
    setForm(formFromTrade(trade));
    setFormOpen(true);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveTrade = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.symbol.trim()) {
      setMessage("Enter a stock, index, option or instrument symbol.");
      return;
    }

    setSaving(true);
    setMessage("");

    const payload = {
      id: form.id,
      tradeTime: Math.floor(new Date(form.dateTime).getTime() / 1000),
      market: form.market,
      instrumentType: form.instrumentType,
      symbol: form.symbol,
      name: form.name,
      side: form.side,
      status: form.status,
      quantity: inputNumber(form.quantity),
      entryPrice: inputNumber(form.entryPrice),
      stopLoss: inputNumber(form.stopLoss),
      targetPrice: inputNumber(form.targetPrice),
      exitPrice: inputNumber(form.exitPrice),
      amountIn: inputNumber(form.amountIn),
      fees: inputNumber(form.fees) ?? 0,
      profitLoss: inputNumber(form.profitLoss),
      currency: form.currency,
      expiry: form.expiry || null,
      strike: inputNumber(form.strike),
      optionType: form.optionType || null,
      setup: form.setup,
      notes: form.notes
    };

    try {
      const response = await fetch("/api/journal/trades", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to save trade.");
      }

      await loadManualTrades();
      setForm(blankForm());
      setFormOpen(false);
      setMessage(form.id ? "Trade updated." : "Trade added to journal.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save trade."
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteTrade = async (trade: ManualTrade) => {
    const confirmed = window.confirm(
      `Delete ${trade.symbol} from the journal?`
    );
    if (!confirmed) return;

    try {
      const response = await fetch(
        `/api/journal/trades?id=${encodeURIComponent(trade.id)}`,
        { method: "DELETE" }
      );
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to delete trade.");
      }
      await loadManualTrades();
      setMessage("Trade deleted.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to delete trade."
      );
    }
  };

  const platformStats = useMemo(
    () => summarizeTrades(platformTrades),
    [platformTrades]
  );

  return (
    <main className="tradeJournalPage">
      <section className="card tradeJournalHero">
        <div>
          <p className="label">ALLINONEVIEW · TRADING JOURNAL</p>
          <h1>Trading Journal</h1>
          <p>
            Record the trades you actually take. Manual entries are stored in
            Neon so the journal is available across devices.
          </p>
        </div>
        <div className="tradeJournalHeroActions">
          <button className="button" type="button" onClick={openNew}>
            + New trade
          </button>
          <a className="tradeHistoryLink" href="/">
            ← Back to chart
          </a>
        </div>
      </section>

      <div className="tradeJournalTabs">
        <button
          className={view === "MANUAL" ? "active" : ""}
          type="button"
          onClick={() => setView("MANUAL")}
        >
          Manual Journal
        </button>
        <button
          className={view === "PLATFORM" ? "active" : ""}
          type="button"
          onClick={() => setView("PLATFORM")}
        >
          Platform Signals
        </button>
      </div>

      {message ? <div className="tradeJournalMessage">{message}</div> : null}

      {view === "MANUAL" ? (
        <>
          {formOpen ? (
            <section className="card manualTradeEditor">
              <div className="manualTradeEditorHeader">
                <div>
                  <p className="label">{form.id ? "EDIT TRADE" : "NEW TRADE"}</p>
                  <h2>{form.id ? form.symbol || "Trade" : "Add trade"}</h2>
                </div>
                <button
                  type="button"
                  className="manualTradeClose"
                  onClick={() => setFormOpen(false)}
                >
                  ×
                </button>
              </div>

              <form onSubmit={saveTrade}>
                <div className="manualTradeFormGrid">
                  <label>
                    <span>Date & time</span>
                    <input
                      type="datetime-local"
                      value={form.dateTime}
                      onChange={(event) =>
                        updateForm("dateTime", event.target.value)
                      }
                      required
                    />
                  </label>

                  <label>
                    <span>Market</span>
                    <select
                      value={form.market}
                      onChange={(event) =>
                        updateForm("market", event.target.value)
                      }
                    >
                      {MARKET_OPTIONS.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Instrument</span>
                    <select
                      value={form.instrumentType}
                      onChange={(event) =>
                        updateForm("instrumentType", event.target.value)
                      }
                    >
                      {INSTRUMENT_TYPES.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Symbol / contract</span>
                    <input
                      value={form.symbol}
                      onChange={(event) =>
                        updateForm("symbol", event.target.value)
                      }
                      placeholder="NIFTY, RELIANCE, XAU_USD…"
                      required
                    />
                  </label>

                  <label>
                    <span>Name / description</span>
                    <input
                      value={form.name}
                      onChange={(event) =>
                        updateForm("name", event.target.value)
                      }
                      placeholder="Optional"
                    />
                  </label>

                  <label>
                    <span>Bought / sold</span>
                    <select
                      value={form.side}
                      onChange={(event) =>
                        updateForm(
                          "side",
                          event.target.value as "BUY" | "SELL"
                        )
                      }
                    >
                      <option value="BUY">BUY / LONG</option>
                      <option value="SELL">SELL / SHORT</option>
                    </select>
                  </label>

                  <label>
                    <span>Status</span>
                    <select
                      value={form.status}
                      onChange={(event) =>
                        updateForm(
                          "status",
                          event.target.value as "OPEN" | "CLOSED"
                        )
                      }
                    >
                      <option value="OPEN">OPEN</option>
                      <option value="CLOSED">CLOSED</option>
                    </select>
                  </label>

                  <label>
                    <span>Currency</span>
                    <select
                      value={form.currency}
                      onChange={(event) =>
                        updateForm("currency", event.target.value)
                      }
                    >
                      {CURRENCIES.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Quantity</span>
                    <input
                      type="number"
                      step="any"
                      value={form.quantity}
                      onChange={(event) =>
                        updateForm("quantity", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    <span>Amount in / capital used</span>
                    <input
                      type="number"
                      step="any"
                      value={form.amountIn}
                      onChange={(event) =>
                        updateForm("amountIn", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    <span>Entry price</span>
                    <input
                      type="number"
                      step="any"
                      value={form.entryPrice}
                      onChange={(event) =>
                        updateForm("entryPrice", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    <span>Stop loss</span>
                    <input
                      type="number"
                      step="any"
                      value={form.stopLoss}
                      onChange={(event) =>
                        updateForm("stopLoss", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    <span>Target</span>
                    <input
                      type="number"
                      step="any"
                      value={form.targetPrice}
                      onChange={(event) =>
                        updateForm("targetPrice", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    <span>Exit price</span>
                    <input
                      type="number"
                      step="any"
                      value={form.exitPrice}
                      onChange={(event) =>
                        updateForm("exitPrice", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    <span>Fees / charges</span>
                    <input
                      type="number"
                      step="any"
                      value={form.fees}
                      onChange={(event) =>
                        updateForm("fees", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    <span>P/L override</span>
                    <input
                      type="number"
                      step="any"
                      value={form.profitLoss}
                      onChange={(event) =>
                        updateForm("profitLoss", event.target.value)
                      }
                      placeholder="Leave blank to auto-calculate"
                    />
                  </label>

                  <label>
                    <span>Expiry</span>
                    <input
                      type="date"
                      value={form.expiry}
                      onChange={(event) =>
                        updateForm("expiry", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    <span>Strike</span>
                    <input
                      type="number"
                      step="any"
                      value={form.strike}
                      onChange={(event) =>
                        updateForm("strike", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    <span>Option type</span>
                    <select
                      value={form.optionType}
                      onChange={(event) =>
                        updateForm(
                          "optionType",
                          event.target.value as ManualTradeForm["optionType"]
                        )
                      }
                    >
                      <option value="">—</option>
                      <option value="CE">CE</option>
                      <option value="PE">PE</option>
                      <option value="CALL">CALL</option>
                      <option value="PUT">PUT</option>
                    </select>
                  </label>

                  <label>
                    <span>Setup / reason</span>
                    <input
                      value={form.setup}
                      onChange={(event) =>
                        updateForm("setup", event.target.value)
                      }
                      placeholder="Fib pullback, breakout, liquidity sweep…"
                    />
                  </label>

                  <label className="manualTradeWide">
                    <span>Notes</span>
                    <textarea
                      value={form.notes}
                      onChange={(event) =>
                        updateForm("notes", event.target.value)
                      }
                      placeholder="Why you entered, what went well, mistakes, psychology…"
                    />
                  </label>
                </div>

                <div className="manualTradePreview">
                  <div>
                    <span>Calculated P/L</span>
                    <strong
                      className={
                        (pnlPreview ?? 0) > 0
                          ? "positive"
                          : (pnlPreview ?? 0) < 0
                            ? "negative"
                            : ""
                      }
                    >
                      {pnlPreview === null
                        ? "—"
                        : formatMoney(pnlPreview, form.currency)}
                    </strong>
                  </div>
                  <div>
                    <span>Planned R:R</span>
                    <strong>
                      {rrPreview === null ? "—" : `1 : ${rrPreview.toFixed(2)}`}
                    </strong>
                  </div>
                  <small>
                    P/L auto-calculates for closed trades when entry, exit and
                    quantity are entered. A manual P/L value overrides it.
                  </small>
                </div>

                <div className="manualTradeEditorActions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setFormOpen(false)}
                  >
                    Cancel
                  </button>
                  <button className="button" type="submit" disabled={saving}>
                    {saving
                      ? "Saving…"
                      : form.id
                        ? "Update trade"
                        : "Save trade"}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          <section className="tradeJournalSummaryGrid">
            <div className="card tradeJournalSummaryCard">
              <span>TRADES</span>
              <strong>{manualStats.total}</strong>
              <small>{manualStats.open} open · {manualStats.closed} closed</small>
            </div>
            <div className="card tradeJournalSummaryCard">
              <span>WIN RATE</span>
              <strong>{manualStats.winRate.toFixed(1)}%</strong>
              <small>Closed trades with P/L</small>
            </div>
            <div className="card tradeJournalSummaryCard">
              <span>BIGGEST WIN</span>
              <strong>
                {manualStats.biggestWin === null
                  ? "—"
                  : manualStats.biggestWin.toLocaleString("en-IN", {
                      maximumFractionDigits: 2
                    })}
              </strong>
              <small>Filtered journal</small>
            </div>
            <div className="card tradeJournalSummaryCard">
              <span>BIGGEST LOSS</span>
              <strong>
                {manualStats.biggestLoss === null
                  ? "—"
                  : manualStats.biggestLoss.toLocaleString("en-IN", {
                      maximumFractionDigits: 2
                    })}
              </strong>
              <small>Filtered journal</small>
            </div>
          </section>

          <section className="card tradeJournalTotals">
            <div>
              <p className="label">ACCUMULATED PROFIT / LOSS</p>
              <h2>Running account result</h2>
            </div>
            <div className="tradeJournalCurrencyTotals">
              {currencyTotals.length ? (
                currencyTotals.map(([code, total]) => (
                  <div key={code}>
                    <span>{code}</span>
                    <strong className={total >= 0 ? "positive" : "negative"}>
                      {formatMoney(total, code)}
                    </strong>
                  </div>
                ))
              ) : (
                <span>No closed P/L yet.</span>
              )}
            </div>
          </section>

          <section className="tradeJournalMiddleGrid">
            <div className="card tradeJournalCalendar">
              <div className="tradeJournalSectionHeader">
                <div>
                  <p className="label">TRADEBOOK</p>
                  <h2>{monthHeatmap.label}</h2>
                </div>
              </div>
              <div className="tradeCalendarWeekdays">
                {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="tradeCalendarGrid">
                {monthHeatmap.cells.map((cell, index) =>
                  cell ? (
                    <div
                      className={
                        cell.pnl > 0
                          ? "profit"
                          : cell.pnl < 0
                            ? "loss"
                            : ""
                      }
                      key={`day-${cell.day}`}
                      title={
                        cell.pnl
                          ? `${cell.day}: ${cell.pnl > 0 ? "+" : ""}${cell.pnl.toFixed(2)}`
                          : String(cell.day)
                      }
                    >
                      <span>{cell.day}</span>
                      {cell.pnl ? <small>{cell.pnl > 0 ? "+" : ""}{cell.pnl.toFixed(0)}</small> : null}
                    </div>
                  ) : (
                    <div className="empty" key={`empty-${index}`} />
                  )
                )}
              </div>
            </div>

            <div className="card tradeJournalFilters">
              <div className="tradeJournalSectionHeader">
                <div>
                  <p className="label">FILTERS</p>
                  <h2>Journal view</h2>
                </div>
              </div>

              <label>
                <span>Search</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Symbol, setup or notes"
                />
              </label>

              <div className="tradeHistoryFilterBlock">
                <span>DATE RANGE</span>
                <div className="tradeHistoryFilterRow">
                  {RANGE_FILTERS.map((item) => (
                    <button
                      className={
                        range === item.value
                          ? "tradeHistoryFilter active"
                          : "tradeHistoryFilter"
                      }
                      key={item.value}
                      onClick={() => setRange(item.value)}
                      type="button"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="manualFilterSelects">
                <label>
                  <span>Market</span>
                  <select
                    value={market}
                    onChange={(event) => setMarket(event.target.value)}
                  >
                    <option value="ALL">ALL</option>
                    {MARKET_OPTIONS.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Currency</span>
                  <select
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value)}
                  >
                    <option value="ALL">ALL</option>
                    {CURRENCIES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </section>

          <section className="card tradeJournalLedger">
            <div className="tradeJournalSectionHeader">
              <div>
                <p className="label">MANUAL TRADE LEDGER</p>
                <h2>{manualFiltered.length} trade{manualFiltered.length === 1 ? "" : "s"}</h2>
              </div>
              <button className="button" type="button" onClick={openNew}>
                + New trade
              </button>
            </div>

            <div className="tradeHistoryTableWrap">
              <table className="tradeHistoryTable manualJournalTable">
                <thead>
                  <tr>
                    <th>Date / time</th>
                    <th>Market</th>
                    <th>Type</th>
                    <th>Symbol</th>
                    <th>Buy / Sell</th>
                    <th>Qty</th>
                    <th>Amount in</th>
                    <th>Entry</th>
                    <th>SL</th>
                    <th>Target</th>
                    <th>Exit</th>
                    <th>P/L</th>
                    <th>Accumulated</th>
                    <th>Status</th>
                    <th>Setup / notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {manualFiltered.length ? (
                    manualFiltered.map((trade) => (
                      <tr key={trade.id}>
                        <td>
                          {new Date(trade.tradeTime * 1000).toLocaleString(
                            undefined,
                            {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            }
                          )}
                        </td>
                        <td>{trade.market}</td>
                        <td>
                          {trade.instrumentType}
                          {trade.optionType ? ` · ${trade.optionType}` : ""}
                          {trade.strike !== null ? ` · ${formatNumber(trade.strike)}` : ""}
                        </td>
                        <td title={trade.name || undefined}>
                          <strong>{trade.symbol}</strong>
                          {trade.expiry ? <small>{trade.expiry}</small> : null}
                        </td>
                        <td className={trade.side === "BUY" ? "positive" : "negative"}>
                          {trade.side}
                        </td>
                        <td>{formatNumber(trade.quantity)}</td>
                        <td>
                          {trade.amountIn === null
                            ? "—"
                            : formatMoney(trade.amountIn, trade.currency)}
                        </td>
                        <td>{formatNumber(trade.entryPrice)}</td>
                        <td>{formatNumber(trade.stopLoss)}</td>
                        <td>{formatNumber(trade.targetPrice)}</td>
                        <td>{formatNumber(trade.exitPrice)}</td>
                        <td
                          className={
                            (trade.profitLoss ?? 0) > 0
                              ? "positive"
                              : (trade.profitLoss ?? 0) < 0
                                ? "negative"
                                : ""
                          }
                        >
                          {trade.profitLoss === null
                            ? trade.status === "OPEN"
                              ? "OPEN"
                              : "—"
                            : formatMoney(trade.profitLoss, trade.currency)}
                        </td>
                        <td
                          className={
                            (accumulatedById.get(trade.id) ?? 0) >= 0
                              ? "positive"
                              : "negative"
                          }
                        >
                          {formatMoney(
                            accumulatedById.get(trade.id) ?? 0,
                            trade.currency
                          )}
                        </td>
                        <td>{trade.status}</td>
                        <td className="manualJournalNotes">
                          <strong>{trade.setup || "—"}</strong>
                          <small>{trade.notes || ""}</small>
                        </td>
                        <td>
                          <div className="manualJournalActions">
                            <button type="button" onClick={() => openEdit(trade)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => void deleteTrade(trade)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={16}>
                        No manual trades match these filters yet. Use “New trade”
                        to record one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="tradeJournalSummaryGrid">
            <div className="card tradeJournalSummaryCard">
              <span>PLATFORM SIGNALS</span>
              <strong>{platformTrades.length}</strong>
              <small>Read-only automatic journal</small>
            </div>
            <div className="card tradeJournalSummaryCard">
              <span>WIN RATE</span>
              <strong>{platformStats.winRate.toFixed(1)}%</strong>
            </div>
            <div className="card tradeJournalSummaryCard">
              <span>TOTAL RESULT</span>
              <strong>{platformStats.totalR >= 0 ? "+" : ""}{platformStats.totalR.toFixed(2)}R</strong>
            </div>
            <div className="card tradeJournalSummaryCard">
              <span>OPEN / CLOSED</span>
              <strong>{platformStats.open} / {platformStats.closed}</strong>
            </div>
          </section>

          <section className="card tradeJournalLedger">
            <div className="tradeJournalSectionHeader">
              <div>
                <p className="label">PLATFORM SIGNAL ARCHIVE</p>
                <h2>Automatic strategy signals</h2>
              </div>
              <small>This section remains read-only.</small>
            </div>

            <div className="tradeHistoryTableWrap">
              <table className="tradeHistoryTable">
                <thead>
                  <tr>
                    <th>Signal</th>
                    <th>Market</th>
                    <th>Symbol</th>
                    <th>Setup</th>
                    <th>Side</th>
                    <th>Entry</th>
                    <th>SL / live stop</th>
                    <th>Outcome</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {platformTrades.length ? (
                    platformTrades
                      .slice()
                      .sort((a, b) => b.signalTime - a.signalTime)
                      .map((trade) => (
                        <tr key={trade.id}>
                          <td>
                            {new Date(trade.signalTime * 1000).toLocaleString()}
                          </td>
                          <td>{trade.market}</td>
                          <td>{trade.symbol}</td>
                          <td>{trade.setupType ?? "PRIMARY"}</td>
                          <td className={trade.direction}>
                            {trade.direction.toUpperCase()}
                          </td>
                          <td>{formatNumber(trade.entry)}</td>
                          <td>{formatNumber(trade.currentStop)}</td>
                          <td>{trade.outcome}</td>
                          <td>
                            {trade.resultR === null
                              ? "OPEN"
                              : `${trade.resultR > 0 ? "+" : ""}${trade.resultR.toFixed(2)}R`}
                          </td>
                        </tr>
                      ))
                  ) : (
                    <tr>
                      <td colSpan={9}>No platform signals recorded yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
