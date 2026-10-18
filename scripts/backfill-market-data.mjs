const baseUrl =
  process.env.MARKET_DATA_BASE_URL?.trim() ||
  "http://127.0.0.1:8080";

const delayMs = Math.max(
  100,
  Number(process.env.MARKET_BACKFILL_DELAY_MS ?? 650)
);

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const profiles = [
  { resolution: "1D", range: "1Y" },
  { resolution: "240", range: "6M" },
  { resolution: "60", range: "3M" },
  { resolution: "15", range: "1M" },
  { resolution: "5", range: "5D" },
  { resolution: "1", range: "5D" }
];

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

const universe = await getJson(
  `${baseUrl}/api/scanner/universe`
);

const instruments = [
  ...(Array.isArray(universe.fyers) ? universe.fyers : []),
  ...(Array.isArray(universe.kraken) ? universe.kraken : [])
];

const seen = new Set();
const queue = [];

for (const instrument of instruments) {
  const market = String(instrument.market ?? "");
  const symbol = String(instrument.symbol ?? "");
  if (!market || !symbol) continue;

  for (const profile of profiles) {
    const key =
      market +
      "|" +
      symbol +
      "|" +
      profile.resolution;
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push({
      market,
      symbol,
      ...profile
    });
  }
}

process.stdout.write(
  `Market history warm-up: ${instruments.length} instruments, ${queue.length} chart histories.\n`
);

let success = 0;
let failed = 0;

for (let index = 0; index < queue.length; index += 1) {
  const item = queue[index];
  const url =
    `${baseUrl}/api/market/history?market=` +
    encodeURIComponent(item.market) +
    "&symbol=" +
    encodeURIComponent(item.symbol) +
    "&resolution=" +
    encodeURIComponent(item.resolution) +
    "&range=" +
    encodeURIComponent(item.range);

  try {
    const body = await getJson(url);
    success += 1;
    process.stdout.write(
      `[${index + 1}/${queue.length}] OK ${item.market} ${item.symbol} ${item.resolution}m/${item.range}: ${body.candles?.length ?? 0} candles cached.\n`
    );
  } catch (error) {
    failed += 1;
    process.stderr.write(
      `[${index + 1}/${queue.length}] FAIL ${item.market} ${item.symbol} ${item.resolution}m/${item.range}: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }

  await sleep(delayMs);
}

process.stdout.write(
  `Market history warm-up complete. Success=${success}, failed=${failed}.\n`
);

if (failed > 0) {
  process.exitCode = 1;
}
