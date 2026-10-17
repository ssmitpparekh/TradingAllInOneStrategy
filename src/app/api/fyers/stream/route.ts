import { NextRequest } from "next/server";
import { fyersDataSocket } from "fyers-api-v3";
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

  let socket: InstanceType<typeof fyersDataSocket> | null = null;
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
        socket = fyersDataSocket.getInstance(websocketToken, "", false);
        socket.autoReconnect(10);
        socket.setQueueProcessInterval?.(200);

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
          safeEnqueue(
            sse(
              {
                connected: false,
                error:
                  error instanceof Error ? error.message : String(error ?? "")
              },
              "status"
            )
          );
        });

        socket.on("close", () => {
          safeEnqueue(
            sse({ connected: false, symbol, closed: true }, "status")
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
