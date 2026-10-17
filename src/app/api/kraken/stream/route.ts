import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESOLUTION_TO_MINUTES: Record<string, number> = {
  "1": 1,
  "5": 5,
  "15": 15,
  "30": 30,
  "60": 60,
  "240": 240,
  "1D": 1440,
  "1W": 10080,
  "1M": 21600
};

function sse(data: unknown, event?: string): Uint8Array {
  const prefix = event ? `event: ${event}\n` : "";
  return new TextEncoder().encode(
    `${prefix}data: ${JSON.stringify(data)}\n\n`
  );
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim() || "BTC/USD";
  const resolution = request.nextUrl.searchParams.get("resolution")?.trim() || "15";
  const interval = RESOLUTION_TO_MINUTES[resolution] ?? 15;

  let upstream: WebSocket | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const safeEnqueue = (payload: Uint8Array) => {
        if (!closed) controller.enqueue(payload);
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;

        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = null;
        }

        try {
          upstream?.close();
        } catch {
          // Upstream may already be closed.
        }
      };

      try {
        upstream = new WebSocket("wss://ws.kraken.com/v2");

        upstream.addEventListener("open", () => {
          safeEnqueue(
            sse(
              {
                connected: true,
                provider: "KRAKEN",
                symbol,
                interval
              },
              "status"
            )
          );

          upstream?.send(
            JSON.stringify({
              method: "subscribe",
              params: {
                channel: "ticker",
                symbol: [symbol],
                snapshot: true,
                event_trigger: "trades"
              }
            })
          );

          upstream?.send(
            JSON.stringify({
              method: "subscribe",
              params: {
                channel: "ohlc",
                symbol: [symbol],
                interval,
                snapshot: true
              }
            })
          );

          upstream?.send(
            JSON.stringify({
              method: "subscribe",
              params: {
                channel: "trade",
                symbol: [symbol],
                snapshot: false
              }
            })
          );
        });

        upstream.addEventListener("message", (event) => {
          try {
            const message = JSON.parse(String(event.data));

            if (message?.channel === "ticker" && Array.isArray(message.data)) {
              for (const item of message.data) {
                safeEnqueue(sse(item, "ticker"));
              }
              return;
            }

            if (message?.channel === "trade" && Array.isArray(message.data)) {
              for (const item of message.data) {
                const timestamp = Date.parse(String(item.timestamp ?? ""));
                const qty = Number(item.qty ?? 0);
                const price = Number(item.price ?? 0);
                const side = item.side === "buy" || item.side === "sell"
                  ? item.side
                  : null;

                if (
                  !Number.isFinite(timestamp) ||
                  !(qty > 0) ||
                  !(price > 0) ||
                  !side
                ) {
                  continue;
                }

                safeEnqueue(
                  sse(
                    {
                      symbol: item.symbol,
                      side,
                      qty,
                      price,
                      time: Math.floor(timestamp / 1000),
                      tradeId: item.trade_id ?? null,
                      ordType: item.ord_type ?? null
                    },
                    "trade"
                  )
                );
              }
              return;
            }

            if (message?.channel === "ohlc" && Array.isArray(message.data)) {
              for (const item of message.data) {
                const timestamp = Date.parse(
                  String(item.interval_begin ?? item.timestamp ?? "")
                );

                if (!Number.isFinite(timestamp)) continue;

                safeEnqueue(
                  sse(
                    {
                      symbol: item.symbol,
                      time: Math.floor(timestamp / 1000),
                      open: Number(item.open),
                      high: Number(item.high),
                      low: Number(item.low),
                      close: Number(item.close),
                      volume: Number(item.volume ?? 0),
                      trades: Number(item.trades ?? 0),
                      interval: Number(item.interval ?? interval)
                    },
                    "candle"
                  )
                );
              }
              return;
            }

            if (message?.success === false) {
              safeEnqueue(
                sse(
                  {
                    connected: false,
                    error: message.error || "Kraken subscription failed."
                  },
                  "status"
                )
              );
            }
          } catch {
            // Ignore non-JSON or unsupported upstream messages.
          }
        });

        upstream.addEventListener("error", () => {
          safeEnqueue(
            sse(
              {
                connected: false,
                error: "Kraken WebSocket error."
              },
              "status"
            )
          );
        });

        upstream.addEventListener("close", () => {
          safeEnqueue(
            sse(
              {
                connected: false,
                closed: true,
                error: "Kraken WebSocket closed."
              },
              "status"
            )
          );
        });

        keepAlive = setInterval(() => {
          safeEnqueue(sse({ ts: Date.now() }, "keepalive"));
        }, 15_000);

        request.signal.addEventListener("abort", cleanup, { once: true });
      } catch (error) {
        safeEnqueue(
          sse(
            {
              connected: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to open Kraken WebSocket."
            },
            "status"
          )
        );
      }
    },

    cancel() {
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }

      try {
        upstream?.close();
      } catch {
        // no-op
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
