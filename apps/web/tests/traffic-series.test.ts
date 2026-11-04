import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TrafficSeries } from '../src/lib/traffic-series.ts';

await test('shows new traffic immediately without duplicating the live interval', () => {
  const series = new TrafficSeries();
  series.update({ totalRequests: 100, totalDurationMs: 500 }, 0);
  const first = series.update(
    { totalRequests: 101, totalDurationMs: 520 },
    100,
  );
  assert.deepEqual(first.at(-1), { at: 100, requests: 1, latency: 20 });
  const next = series.update({ totalRequests: 103, totalDurationMs: 560 }, 200);
  assert.equal(next.length, 2);
  assert.deepEqual(next.at(-1), { at: 200, requests: 3, latency: 20 });
  assert.deepEqual(series.sample(5000).at(-1), {
    at: 5000,
    requests: 3,
    latency: 20,
  });
  const following = series.update(
    { totalRequests: 104, totalDurationMs: 570 },
    5100,
  );
  assert.deepEqual(following.at(-2), { at: 5000, requests: 3, latency: 20 });
  assert.deepEqual(following.at(-1), { at: 5100, requests: 1, latency: 10 });
});

await test('keeps completed data through idle periods and shows no invented latency', () => {
  const series = new TrafficSeries();
  assert.deepEqual(series.sample(0), []);
  series.update({ totalRequests: 10, totalDurationMs: 50 }, 0);
  series.update({ totalRequests: 11, totalDurationMs: 60 }, 10);
  series.sample(5000);
  const idle = series.sample(10000);
  assert.deepEqual(idle.at(-2), { at: 5000, requests: 1, latency: 10 });
  assert.deepEqual(idle.at(-1), { at: 10000, requests: 0, latency: null });
});

await test('keeps the newest points when the visible window is full', () => {
  const series = new TrafficSeries(3);
  series.update({ totalRequests: 0, totalDurationMs: 0 }, 0);
  for (let index = 1; index <= 5; index++) {
    series.update(
      { totalRequests: index, totalDurationMs: index * 10 },
      index * 5000 - 1,
    );
    series.sample(index * 5000);
  }
  const live = series.update({ totalRequests: 6, totalDurationMs: 60 }, 25001);
  assert.equal(live.length, 3);
  assert.deepEqual(
    live.map((point) => point.at),
    [20000, 25000, 25001],
  );
  assert.deepEqual(live.at(-1), { at: 25001, requests: 1, latency: 10 });
});
