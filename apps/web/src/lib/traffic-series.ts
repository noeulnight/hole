export interface HttpTotals {
  totalRequests: number;
  totalDurationMs: number;
}

export interface TrafficSample {
  at: number;
  requests: number;
  latency: number | null;
}

export function sampleTraffic(
  previous: HttpTotals,
  current: HttpTotals,
  at: number,
): TrafficSample {
  const reset =
    current.totalRequests < previous.totalRequests ||
    current.totalDurationMs < previous.totalDurationMs;
  const requests = reset ? 0 : current.totalRequests - previous.totalRequests;
  return {
    at,
    requests,
    latency:
      requests > 0
        ? (current.totalDurationMs - previous.totalDurationMs) / requests
        : null,
  };
}

export class TrafficSeries {
  private baseline: HttpTotals | null = null;
  private latest: HttpTotals | null = null;
  private history: TrafficSample[] = [];

  private readonly maxSamples: number;

  constructor(maxSamples = 60) {
    this.maxSamples = maxSamples;
  }

  update(totals: HttpTotals, at: number): TrafficSample[] {
    this.latest = totals;
    if (!this.baseline) {
      this.baseline = totals;
      this.history = [sampleTraffic(totals, totals, at)];
      return this.history;
    }
    // Replace the live bucket without adding another completed interval.
    return [...this.history, sampleTraffic(this.baseline, totals, at)].slice(
      -this.maxSamples,
    );
  }

  sample(at: number): TrafficSample[] {
    if (!this.baseline || !this.latest) return this.history;
    const sample = sampleTraffic(this.baseline, this.latest, at);
    this.baseline = this.latest;
    this.history = [...this.history, sample].slice(-this.maxSamples);
    return this.history;
  }
}
