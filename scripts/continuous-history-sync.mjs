import { spawn } from "node:child_process";

const intervalMs = Math.max(
  30 * 60_000,
  Number(process.env.HISTORY_SYNC_INTERVAL_MS ?? 4 * 60 * 60_000)
);

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function cycle() {
  process.stdout.write(
    `[${new Date().toISOString()}] starting exact-history sync cycle\n`
  );

  const marketCode = await run("npm", ["run", "backfill:market"]);
  if (marketCode !== 0) {
    process.stderr.write(
      `[${new Date().toISOString()}] FYERS/Kraken history sync finished with errors; continuing to OANDA.\n`
    );
  }

  const oandaCode = await run("npm", ["run", "backfill:oanda"]);
  if (oandaCode !== 0) {
    process.stderr.write(
      `[${new Date().toISOString()}] OANDA history sync finished with errors.\n`
    );
  }

  process.stdout.write(
    `[${new Date().toISOString()}] history sync cycle complete; next cycle in ${Math.round(intervalMs / 60_000)} minutes.\n`
  );
}

let stopping = false;

const shutdown = () => {
  stopping = true;
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

while (!stopping) {
  await cycle();

  if (stopping) break;

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, intervalMs);
    const check = setInterval(() => {
      if (!stopping) return;
      clearInterval(check);
      clearTimeout(timer);
      resolve();
    }, 1000);
  });
}
