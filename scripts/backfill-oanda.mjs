const baseUrl =
  process.env.MARKET_DATA_BASE_URL?.trim() ||
  "http://127.0.0.1:8080";

const delayMs = Math.max(
  100,
  Number(process.env.OANDA_BACKFILL_DELAY_MS ?? 450)
);

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });
  const body = await response.json();

  if (!response.ok || body?.ok === false) {
    throw new Error(
      body?.error || `HTTP ${response.status}`
    );
  }

  return body;
}

const inventory = await getJson(
  `${baseUrl}/api/oanda/instruments?all=1`
);

const instruments = Array.isArray(inventory.instruments)
  ? inventory.instruments
  : [];

if (!instruments.length) {
  throw new Error(
    "No OANDA instruments returned. Configure OANDA_API_TOKEN in .env.local and restart npm run dev."
  );
}

const majorFx = new Set([
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CAD",
  "AUD_USD",
  "NZD_USD",
  "USD_CHF",
  "EUR_GBP",
  "EUR_JPY",
  "GBP_JPY",
  "AUD_JPY",
  "CAD_JPY"
]);

const broadProfiles = [
  { resolution: "1D", range: "MAX" },
  { resolution: "240", range: "6M" },
  { resolution: "60", range: "3M" }
];

const coreProfiles = [
  { resolution: "15", range: "1M" },
  { resolution: "5", range: "5D" },
  { resolution: "1", range: "5D" }
];

const coreTypes = new Set([
  "COMMODITY",
  "INDEX",
  "CRYPTO"
]);

const jobs = [];

for (const instrument of instruments) {
  for (const profile of broadProfiles) {
    jobs.push({
      symbol: instrument.symbol,
      name: instrument.name,
      type: instrument.type,
      ...profile
    });
  }

  if (
    coreTypes.has(instrument.type) ||
    majorFx.has(instrument.symbol)
  ) {
    for (const profile of coreProfiles) {
      jobs.push({
        symbol: instrument.symbol,
        name: instrument.name,
        type: instrument.type,
        ...profile
      });
    }
  }
}

process.stdout.write(
  `OANDA warm-up: ${instruments.length} account instruments, ${jobs.length} histories.\n`
);

let success = 0;
let failed = 0;

for (let index = 0; index < jobs.length; index += 1) {
  const item = jobs[index];
  const url =
    `${baseUrl}/api/market/history?market=OANDA&symbol=` +
    encodeURIComponent(item.symbol) +
    "&resolution=" +
    encodeURIComponent(item.resolution) +
    "&range=" +
    encodeURIComponent(item.range);

  try {
    const body = await getJson(url);
    success += 1;
    process.stdout.write(
      `[${index + 1}/${jobs.length}] OK OANDA ${item.symbol} ${item.resolution}/${item.range}: ${body.candles?.length ?? 0} candles cached.\n`
    );
  } catch (error) {
    failed += 1;
    process.stderr.write(
      `[${index + 1}/${jobs.length}] FAIL OANDA ${item.symbol} ${item.resolution}/${item.range}: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }

  await sleep(delayMs);
}

process.stdout.write(
  `OANDA warm-up complete. Success=${success}, failed=${failed}.\n`
);

if (failed > 0) {
  process.exitCode = 1;
}
