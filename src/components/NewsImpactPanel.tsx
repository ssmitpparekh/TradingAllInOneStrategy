"use client";

import type {
  NewsGate,
  NewsImpactEvent
} from "@/lib/news/impact";

type Props = {
  events: NewsImpactEvent[];
  gate: NewsGate;
  connected: boolean;
  xConfigured: boolean;
  xStreaming: boolean;
};

function formatLatency(ms: number | null) {
  if (ms === null) return "latency n/a";
  if (ms < 1000) return Math.round(ms) + " ms";
  if (ms < 60_000) return (ms / 1000).toFixed(1) + " s";
  return Math.round(ms / 60_000) + " min";
}

function ageLabel(timestamp: number) {
  const age = Math.max(0, Date.now() - timestamp);
  if (age < 60_000) return Math.floor(age / 1000) + "s";
  if (age < 60 * 60_000) return Math.floor(age / 60_000) + "m";
  return Math.floor(age / (60 * 60_000)) + "h";
}

export default function NewsImpactPanel({
  events,
  gate,
  connected,
  xConfigured,
  xStreaming
}: Props) {
  const top = events
    .slice()
    .sort((a, b) => {
      if (b.severity !== a.severity) return b.severity - a.severity;
      return b.receivedAt - a.receivedAt;
    })
    .slice(0, 12);

  return (
    <section
      className={
        "card newsImpactCard " +
        gate.riskLevel.toLowerCase()
      }
    >
      <div className="newsImpactHeader">
        <div>
          <p className="label">LIVE NEWS IMPACT ENGINE</p>
          <h3>
            {gate.blocked
              ? "NEWS HOLD — technical entry paused"
              : gate.riskLevel === "HIGH"
                ? "High-impact news active"
                : gate.riskLevel === "WATCH"
                  ? "News watch active"
                  : "No critical mapped news risk"}
          </h3>
          <p>{gate.reason}</p>
        </div>

        <div className="newsImpactStatus">
          <span className={connected ? "online" : ""}>
            {connected ? "NEWS LIVE" : "CONNECTING"}
          </span>
          <small>
            X {xStreaming ? "STREAM" : xConfigured ? "POLL" : "NOT CONNECTED"}
          </small>
        </div>
      </div>

      {gate.event ? (
        <div className="newsGateEvent">
          <div>
            <span>
              {gate.event.severityClass} · {gate.event.source}
            </span>
            <strong>{gate.event.headline}</strong>
          </div>
          <div className="newsGateStats">
            <span>{gate.event.severity}/100 impact</span>
            <span>{gate.confidence}% confidence</span>
            <span>{gate.direction.toUpperCase()}</span>
            <span>{formatLatency(gate.event.latencyMs)}</span>
          </div>
        </div>
      ) : null}

      <div className="newsFeedList">
        {top.length ? (
          top.map((event) => (
            <article className="newsFeedItem" key={event.id}>
              <div className="newsFeedMeta">
                <span
                  className={
                    "newsSeverity " +
                    event.severityClass.toLowerCase()
                  }
                >
                  {event.severityClass}
                </span>
                <span>{event.source}</span>
                <span>{event.region}</span>
                <span>{formatLatency(event.latencyMs)}</span>
                <small>{ageLabel(event.receivedAt)} ago</small>
              </div>

              {event.url ? (
                <a
                  href={event.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {event.headline}
                </a>
              ) : (
                <strong>{event.headline}</strong>
              )}

              <div className="newsFeedImpact">
                <span>Bias {event.bias.replaceAll("_", " ")}</span>
                <span>Confidence {event.confidence}%</span>
                <span>Horizon {event.horizon.replaceAll("_", " ")}</span>
                {event.tags.slice(0, 4).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </article>
          ))
        ) : (
          <div className="newsEmpty">
            Waiting for official/global news events…
          </div>
        )}
      </div>

      <p className="newsImpactFootnote">
        News direction is an impact estimate, never a standalone entry.
        Critical verified news can pause technical signals; opposite trades
        still require real price confirmation.
      </p>
    </section>
  );
}
