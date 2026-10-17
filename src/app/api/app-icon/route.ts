import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get("size") || 512);
  const size = requested === 180 || requested === 192 ? requested : 512;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#080b10",
          color: "#f4f7fb",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontWeight: 800,
          letterSpacing: "-0.08em"
        }}
      >
        <div
          style={{
            width: "78%",
            height: "78%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "24%",
            background:
              "linear-gradient(145deg, #14234a 0%, #0a1019 50%, #1c2850 100%)",
            border: "2px solid #33466d",
            boxShadow: "0 24px 70px rgba(0,0,0,0.45)",
            fontSize: Math.round(size * 0.23)
          }}
        >
          A1V
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=86400"
      }
    }
  );
}
