import { NextRequest } from "next/server";
import { openOandaPricingStream } from "@/lib/oanda";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: NextRequest) {
  const symbol =
    request.nextUrl.searchParams.get("symbol")?.trim() || "";

  if (!symbol) {
    return new Response(
      sse("status", {
        connected: false,
        error: "OANDA symbol is required."
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive"
        }
      }
    );
  }

  const encoder = new TextEncoder();
  const upstreamAbort = new AbortController();

  request.signal.addEventListener("abort", () => {
    upstreamAbort.abort();
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(event, payload)));
        } catch {
          upstreamAbort.abort();
        }
      };

      send("status", {
        connected: false,
        opening: true,
        provider: "OANDA",
        symbol
      });

      try {
        const response = await openOandaPricingStream(
          symbol,
          upstreamAbort.signal
        );

        send("status", {
          connected: true,
          opening: false,
          provider: "OANDA",
          symbol
        });

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!upstreamAbort.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;

            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(line);
            } catch {
              continue;
            }

            const type = String(payload.type ?? "");

            if (type === "HEARTBEAT") {
              send("heartbeat", {
                time: payload.time ?? null
              });
              continue;
            }

            if (type !== "PRICE") continue;

            const bids = Array.isArray(payload.bids)
              ? (payload.bids as Array<Record<string, unknown>>)
              : [];
            const asks = Array.isArray(payload.asks)
              ? (payload.asks as Array<Record<string, unknown>>)
              : [];

            const bid = Number(bids[0]?.price ?? payload.closeoutBid ?? 0);
            const ask = Number(asks[0]?.price ?? payload.closeoutAsk ?? 0);
            const mid =
              bid > 0 && ask > 0
                ? (bid + ask) / 2
                : Number(payload.closeoutBid ?? payload.closeoutAsk ?? 0);

            if (!(mid > 0)) continue;

            const timeSeconds = Math.floor(
              Number(payload.time ?? Date.now() / 1000)
            );

            send("price", {
              symbol: String(payload.instrument ?? symbol),
              time: Number.isFinite(timeSeconds)
                ? timeSeconds
                : Math.floor(Date.now() / 1000),
              bid,
              ask,
              mid,
              tradeable: payload.tradeable ?? null,
              status: payload.status ?? null
            });
          }
        }
      } catch (error) {
        if (!upstreamAbort.signal.aborted) {
          send("status", {
            connected: false,
            opening: false,
            provider: "OANDA",
            symbol,
            error:
              error instanceof Error
                ? error.message
                : "OANDA pricing stream failed."
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Client may already be gone.
        }
      }
    },
    cancel() {
      upstreamAbort.abort();
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
