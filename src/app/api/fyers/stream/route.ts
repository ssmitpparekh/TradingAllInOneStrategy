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

  const symbol =
    request.nextUrl.searchParams.get("symbol")?.trim() || "NSE:NIFTY50-INDEX";
  const { appId } = getFyersConfig();
  const websocketToken = `${appId}:${session.accessToken}`;

  type DataSocketInstance = {
    LiteMode?: unknown;
    FullMode?: unknown;
    subscribe(symbols: string[], marketDepth?: boolean): void;
    unsubscribe?(symbols: string[], marketDepth?: boolean): void;
    mode?(mode: unknown): void;
    autoReconnect?(retryCount?: number): void;
    autoreconnect?(retryCount?: number): void;
    setQueueProcessInterval?(intervalMs: number): void;
    connect(): void;
    close(): void;
    isConnected?(): boolean;
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

        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = null;
        }

        try {
          socket?.close();
        } catch {
          // The client may already have closed the FYERS socket.
        }
      };

      try {
        const require = createRequire(import.meta.url);
        const sdk = require("fyers-api-v3");
        const DataSocket = sdk?.fyersDataSocket;

        if (!DataSocket || typeof DataSocket.getInstance !== "function") {
          throw new Error(
            "FYERS SDK loaded but fyersDataSocket.getInstance() is unavailable."
          );
        }

        socket = DataSocket.getInstance(websocketToken, "", false);

        // FYERS has shipped both autoReconnect() and autoreconnect()
        // spellings across Node SDK/docs. Support either without crashing.
        if (typeof socket.autoReconnect === "function") {
          socket.autoReconnect(10);
        } else if (typeof socket.autoreconnect === "function") {
          socket.autoreconnect(10);
        }

        socket.setQueueProcessInterval?.(200);

        safeEnqueue(
          sse(
            {
              connected: false,
              opening: true,
              symbol,
              transport: "FYERS Data Socket"
            },
            "status"
          )
        );

        socket.on("connect", () => {
          socket?.subscribe([symbol]);
          safeEnqueue(
            sse(
              { connected: true, symbol, transport: "FYERS Data Socket" },
              "status"
            )
          );
        });

        socket.on("message", (message: Record<string, unknown>) => {
          safeEnqueue(sse(message, "tick"));
        });

        socket.on("error", (error: unknown) => {
          const detail =
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : JSON.stringify(error ?? {});
          safeEnqueue(
            sse(
              {
                connected: false,
                error: detail || "FYERS Data Socket error"
              },
              "status"
            )
          );
        });

        socket.on("close", (reason?: unknown) => {
          safeEnqueue(
            sse(
              {
                connected: false,
                symbol,
                closed: true,
                error:
                  typeof reason === "string"
                    ? reason
                    : "FYERS Data Socket closed"
              },
              "status"
            )
          );
        });

        socket.connect();

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
                  : "Unable to open FYERS Data Socket."
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
        socket?.close();
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
