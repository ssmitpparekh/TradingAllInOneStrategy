import AnalyticsHeader from "@/components/analytics/AnalyticsHeader";

export default function FiiDiiPage() {
  return (
    <main className="analyticsPage">
      <AnalyticsHeader
        title="FII / DII"
        description="Institutional cash-market activity dashboard."
        badge="OFFICIAL SOURCE REQUIRED"
      />

      <section className="card dataSourcePendingCard">
        <p className="label">DATA INTEGRITY</p>
        <h2>Not connected yet</h2>
        <p>
          NSE publishes provisional FII/FPI and DII activity, while final FPI
          figures are confirmed through NSDL/CDSL. ALLINONEVIEW will not scrape
          or invent institutional-flow numbers.
        </p>

        <div className="dataSourcePendingGrid">
          <div>
            <span>Planned fields</span>
            <strong>FII buy · sell · net</strong>
          </div>
          <div>
            <span>Planned fields</span>
            <strong>DII buy · sell · net</strong>
          </div>
          <div>
            <span>History</span>
            <strong>Daily cumulative flow</strong>
          </div>
          <div>
            <span>Use in strategy</span>
            <strong>Context only until validated</strong>
          </div>
        </div>
      </section>

      <p className="analyticsMethodNote">
        This page intentionally remains empty rather than presenting
        unlicensed, stale or fabricated institutional-flow data.
      </p>
    </main>
  );
}
