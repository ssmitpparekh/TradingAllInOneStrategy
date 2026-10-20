export const BACKTEST_INSTRUMENT_KEYS = [
  "GOLD",
  "BTC",
  "NIFTY50",
  "BANKNIFTY",
  "SENSEX",
  "ETH",
  "CRUDEOIL",
  "USOIL",
  "SILVER"
] as const;

export type BacktestInstrumentKey =
  (typeof BACKTEST_INSTRUMENT_KEYS)[number];

export type BacktestInstrument = {
  key: BacktestInstrumentKey;
  label: string;
  provider: "FYERS" | "KRAKEN" | "OANDA";
  market: string;
  symbol: string;
  note: string;
};

export const BACKTEST_INSTRUMENTS: BacktestInstrument[] = [
  { key: "GOLD", label: "Gold", provider: "OANDA", market: "OANDA", symbol: "XAU_USD", note: "OANDA spot gold / USD." },
  { key: "BTC", label: "BTC", provider: "KRAKEN", market: "KRAKEN", symbol: "BTC/USD", note: "Kraken BTC/USD spot." },
  { key: "NIFTY50", label: "NIFTY 50", provider: "FYERS", market: "NSE", symbol: "NSE:NIFTY50-INDEX", note: "FYERS NIFTY 50 index." },
  { key: "BANKNIFTY", label: "BANK NIFTY", provider: "FYERS", market: "NSE", symbol: "NSE:NIFTYBANK-INDEX", note: "FYERS NIFTY Bank index." },
  { key: "SENSEX", label: "SENSEX", provider: "FYERS", market: "BSE", symbol: "BSE:SENSEX-INDEX", note: "FYERS BSE SENSEX index." },
  { key: "ETH", label: "ETH", provider: "KRAKEN", market: "KRAKEN", symbol: "ETH/USD", note: "Kraken ETH/USD spot." },
  { key: "CRUDEOIL", label: "Crude Oil", provider: "OANDA", market: "OANDA", symbol: "BCO_USD", note: "OANDA Brent crude oil benchmark." },
  { key: "USOIL", label: "US Oil", provider: "OANDA", market: "OANDA", symbol: "WTICO_USD", note: "OANDA WTI crude oil benchmark." },
  { key: "SILVER", label: "Silver", provider: "OANDA", market: "OANDA", symbol: "XAG_USD", note: "OANDA silver / USD." }
];

export function isBacktestInstrumentKey(
  value: string
): value is BacktestInstrumentKey {
  return (BACKTEST_INSTRUMENT_KEYS as readonly string[]).includes(value);
}
