"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("ALLINONEVIEW runtime error", error);
  }, [error]);

  return (
    <main className="shell productionState">
      <section className="card productionMessage">
        <p className="eyebrow">ALLINONEVIEW</p>
        <h1>Something went wrong</h1>
        <p>
          The market terminal hit an unexpected error. Your credentials are not
          shown here. Retry the screen, and reconnect the data provider only if
          the problem continues.
        </p>
        <button className="button" onClick={reset}>
          Retry
        </button>
      </section>
    </main>
  );
}
