export default function AnalyticsHeader({
  eyebrow = "ALLINONEVIEW · MARKETS",
  title,
  description,
  badge
}: {
  eyebrow?: string;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <header className="analyticsPageHeader">
      <div>
        <p className="label">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {badge ? <span className="analyticsSourceBadge">{badge}</span> : null}
    </header>
  );
}
