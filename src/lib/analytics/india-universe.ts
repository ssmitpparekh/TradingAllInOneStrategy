export type IndiaCoreInstrument = {
  ticker: string;
  symbol: string;
  name: string;
  sector: string;
};

const rows: Array<[string, string, string]> = [
  ["RELIANCE", "Reliance Industries", "ENERGY"],
  ["HDFCBANK", "HDFC Bank", "BANK"],
  ["ICICIBANK", "ICICI Bank", "BANK"],
  ["INFY", "Infosys", "IT"],
  ["TCS", "TCS", "IT"],
  ["SBIN", "State Bank of India", "BANK"],
  ["BHARTIARTL", "Bharti Airtel", "TELECOM"],
  ["LT", "Larsen & Toubro", "INDUSTRIAL"],
  ["ITC", "ITC", "FMCG"],
  ["AXISBANK", "Axis Bank", "BANK"],
  ["KOTAKBANK", "Kotak Mahindra Bank", "BANK"],
  ["HINDUNILVR", "Hindustan Unilever", "FMCG"],
  ["MARUTI", "Maruti Suzuki", "AUTO"],
  ["M&M", "Mahindra & Mahindra", "AUTO"],
  ["BAJFINANCE", "Bajaj Finance", "FINANCIAL"],
  ["BAJAJFINSV", "Bajaj Finserv", "FINANCIAL"],
  ["SUNPHARMA", "Sun Pharma", "PHARMA"],
  ["TATAMOTORS", "Tata Motors", "AUTO"],
  ["TATASTEEL", "Tata Steel", "METAL"],
  ["JSWSTEEL", "JSW Steel", "METAL"],
  ["HCLTECH", "HCL Technologies", "IT"],
  ["TECHM", "Tech Mahindra", "IT"],
  ["WIPRO", "Wipro", "IT"],
  ["ULTRACEMCO", "UltraTech Cement", "CEMENT"],
  ["NTPC", "NTPC", "POWER"],
  ["POWERGRID", "Power Grid", "POWER"],
  ["COALINDIA", "Coal India", "ENERGY"],
  ["ONGC", "ONGC", "ENERGY"],
  ["ADANIENT", "Adani Enterprises", "INDUSTRIAL"],
  ["ADANIPORTS", "Adani Ports", "INDUSTRIAL"],
  ["GRASIM", "Grasim Industries", "CEMENT"],
  ["DRREDDY", "Dr Reddy's", "PHARMA"],
  ["CIPLA", "Cipla", "PHARMA"],
  ["APOLLOHOSP", "Apollo Hospitals", "HEALTHCARE"],
  ["ASIANPAINT", "Asian Paints", "CONSUMER"],
  ["TITAN", "Titan", "CONSUMER"],
  ["TRENT", "Trent", "CONSUMER"],
  ["EICHERMOT", "Eicher Motors", "AUTO"],
  ["HEROMOTOCO", "Hero MotoCorp", "AUTO"],
  ["BPCL", "BPCL", "ENERGY"],
  ["BRITANNIA", "Britannia", "FMCG"],
  ["BEL", "Bharat Electronics", "INDUSTRIAL"],
  ["JIOFIN", "Jio Financial Services", "FINANCIAL"],
  ["SHRIRAMFIN", "Shriram Finance", "FINANCIAL"],
  ["ETERNAL", "Eternal", "CONSUMER"],
  ["INDUSINDBK", "IndusInd Bank", "BANK"],
  ["HDFCLIFE", "HDFC Life", "FINANCIAL"],
  ["SBILIFE", "SBI Life", "FINANCIAL"],
  ["DIVISLAB", "Divi's Laboratories", "PHARMA"],
  ["NESTLEIND", "Nestle India", "FMCG"],
  ["HINDALCO", "Hindalco", "METAL"],
  ["TATACONSUM", "Tata Consumer", "FMCG"],
  ["BAJAJ-AUTO", "Bajaj Auto", "AUTO"]
];

export const INDIA_CORE: IndiaCoreInstrument[] = rows.map(
  ([ticker, name, sector]) => ({
    ticker,
    symbol: `NSE:${ticker}-EQ`,
    name,
    sector
  })
);

export const INDIA_INDEXES = [
  { symbol: "NSE:NIFTY50-INDEX", name: "NIFTY 50" },
  { symbol: "NSE:NIFTYBANK-INDEX", name: "NIFTY BANK" },
  { symbol: "NSE:FINNIFTY-INDEX", name: "FINNIFTY" },
  { symbol: "NSE:NIFTYIT-INDEX", name: "NIFTY IT" },
  { symbol: "NSE:NIFTYMIDCAP50-INDEX", name: "NIFTY MIDCAP 50" },
  { symbol: "BSE:SENSEX-INDEX", name: "SENSEX" }
] as const;

export const SECTOR_ORDER = [
  "IT",
  "BANK",
  "FINANCIAL",
  "AUTO",
  "METAL",
  "ENERGY",
  "POWER",
  "FMCG",
  "PHARMA",
  "HEALTHCARE",
  "CONSUMER",
  "CEMENT",
  "INDUSTRIAL",
  "TELECOM"
];
