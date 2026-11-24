import type { LagConfig } from '@golfwars/shared';

/** Reads `?lag=150&jitter=20&loss=2` (RTT ms, jitter ms, loss %) from the page URL. */
export function lagFromUrl(search = location.search): LagConfig {
  const q = new URLSearchParams(search);
  const num = (k: string): number => {
    const v = Number(q.get(k));
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  return { rttMs: num('lag'), jitterMs: num('jitter'), lossPct: Math.min(100, num('loss')) };
}
