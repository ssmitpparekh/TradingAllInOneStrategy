import { NextRequest } from "next/server";
import { createRequire } from "node:module";
import { getFyersConfig } from "@/lib/fyers";
import { readFyersSession } from "@/lib/fyers-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(data: unknown, event?: string): Uint8Array {
  const prefix = event ? `event: ${event}\n` : "";
  return new TextEncoder().encode(
    `${prefix}data: ${JSON.stringify(data)}\n\n`
  );
}

export async function GET(request: NextRequest) {
  const session = await readFyersSession();

  if (!session?.accessToken) {
    return new Response("FYERS is not connected.", { status: 401 });
  }

  const symbols = [
    ...new Set(
      (request.nextUrl.searchParams.get("symbols") ?? "")
        .split(",")
        .map((symbol) => symbol.trim())
        .filter(Boolean)
    )
  ].slice(0, 90);

  if (!symbols.length) {
    return new Response("At least one scanner symbol is required.", {
      status: 400
    });
  }

  const { appId } = getFyersConfig();
  const websocketToken = `${appId}:${session.accessToken}`;

  type DataSocketInstance = {
    LiteMode?: unknown;
    subscribe(symbols: string[], marketDepth?: boolean): void;
    mode?(mode: unknown): void;
    autoReconnect?(retryCount?: number): void;
    autoreconnect?(retryCount?: number): void;
    setQueueProcessInterval?(intervalMs: number): void;
    connect(): void;
    close(): void;
    on(event: string, handler: (...args: any[]) => void): void;
  };

  let socket: DataSocketInstance | null = null;
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
        if (keepAlive) clearInterval(keepAlive);
        keepAlive = null;
        try {
          socket?.close();
        } catch {
          // already closed
        }
      };

      try {
        const require = createRequire(import.meta.url);
        const sdk = require("fyers-api-v3");
        const DataSocket = sdk?.fyersDataSocket;

        if (!DataSocket || typeof DataSocket.getInstance !== "function") {
          throw new Error("FYERS Data Socket is unavailable.");
        }

        const liveSocket = DataSocket.getInstance(
          websocketToken,
          "",
          false
        ) as DataSocketInstance;
        socket = liveSocket;

        if (typeof liveSocket.autoReconnect === "function") {
          liveSocket.autoReconnect(25);
        } else if (typeof liveSocket.autoreconnect === "function") {
          liveSocket.autoreconnect(25);
        }

        liveSocket.setQueueProcessInterval?.(100);

        safeEnqueue(
          sse(
            {
              connected: false,
              opening: true,
              symbols: symbols.length
            },
            "status"
          )
        );

        liveSocket.on("connect", () => {
          if (
            liveSocket.mode &&
            liveSocket.LiteMode !== undefined
          ) {
            liveSocket.mode(liveSocket.LiteMode);
          }

          liveSocket.subscribe(symbols);

          safeEnqueue(
            sse(
              {
                connected: true,
                symbols: symbols.length,
                mode: "lite"
              },
              "status"
            )
          );
        });

        liveSocket.on(
          "message",
          (message: Record<string, unknown>) => {
            const symbol = String(message.symbol ?? "");
            const ltp = Number(message.ltp ?? 0);

            if (!symbol || !(ltp > 0)) return;

            safeEnqueue(
              sse(
                {
                  symbol,
                  ltp,
                  type: message.type ?? null,
                  time: Math.floor(Date.now() / 1000)
                },
                "tick"
              )
            );
          }
        );

        liveSocket.on("error", (error: unknown) => {
          safeEnqueue(
            sse(
              {
                connected: false,
                error:
                  error instanceof Error
                    ? error.message
                    : String(error ?? "FYERS scanner socket error")
              },
              "status"
            )
          );
        });

        liveSocket.on("close", () => {
          safeEnqueue(
            sse(
              {
                connected: false,
                closed: true
              },
              "status"
            )
          );
        });

        liveSocket.connect();

        keepAlive = setInterval(() => {
          safeEnqueue(sse({ ts: Date.now() }, "keepalive"));
        }, 15_000);

        request.signal.addEventListener("abort", cleanup, {
          once: true
        });
      } catch (error) {
        safeEnqueue(
          sse(
            {
              connected: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to open scanner socket."
            },
            "status"
          )
        );
      }
    },
    cancel() {
      try {
        socket?.close();
      } catch {
        // no-op
      }
      if (keepAlive) clearInterval(keepAlive);
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
