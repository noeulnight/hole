import { memo, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrafficSeries } from '@/lib/traffic-series';
import type { HttpTotals, TrafficSample } from '@/lib/traffic-series';

const SAMPLE_INTERVAL_MS = 5000;
const tick = { fill: 'var(--muted-foreground)', fontSize: 10 };
const tooltipStyle = {
  backgroundColor: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 12,
};

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function SessionTrafficCharts({
  totals,
  active,
}: {
  totals?: HttpTotals;
  active: boolean;
}) {
  const [series] = useState(() => new TrafficSeries());
  const [samples, setSamples] = useState<TrafficSample[]>([]);

  useEffect(() => {
    if (totals) setSamples(series.update(totals, Date.now()));
  }, [totals, series]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setSamples(series.sample(Date.now()));
    }, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, series]);

  return <TrafficCharts samples={samples} />;
}

export default memo(
  SessionTrafficCharts,
  (previous, next) =>
    previous.active === next.active &&
    previous.totals?.totalRequests === next.totals?.totalRequests &&
    previous.totals?.totalDurationMs === next.totals?.totalDurationMs,
);

const TrafficCharts = memo(function TrafficCharts({
  samples,
}: {
  samples: TrafficSample[];
}) {
  return (
    <section
      aria-label="Live HTTP charts"
      className="grid gap-4 sm:grid-cols-2"
    >
      <Card className="min-w-0 shadow-none">
        <CardHeader className="px-4 pt-4">
          <CardTitle className="text-xs font-medium">Requests / 5s</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pt-3 pb-3">
          <div
            className="h-36 min-w-0"
            aria-label="Request count in five-second intervals"
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              initialDimension={{ width: 400, height: 144 }}
            >
              <AreaChart
                data={samples}
                margin={{ top: 5, right: 12, bottom: 0, left: -12 }}
                accessibilityLayer
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="at"
                  tickFormatter={formatTime}
                  tick={tick}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={50}
                />
                <YAxis
                  allowDecimals={false}
                  tick={tick}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  labelFormatter={(value) => formatTime(Number(value))}
                  contentStyle={tooltipStyle}
                />
                <Area
                  type="monotoneX"
                  dataKey="requests"
                  name="Requests"
                  stroke="var(--foreground)"
                  fill="var(--foreground)"
                  fillOpacity={0.06}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      <Card className="min-w-0 shadow-none">
        <CardHeader className="px-4 pt-4">
          <CardTitle className="text-xs font-medium">
            Avg latency · ms
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pt-3 pb-3">
          <div
            className="h-36 min-w-0"
            aria-label="Average HTTP latency in five-second intervals"
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              initialDimension={{ width: 400, height: 144 }}
            >
              <LineChart
                data={samples}
                margin={{ top: 5, right: 12, bottom: 0, left: -12 }}
                accessibilityLayer
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="at"
                  tickFormatter={formatTime}
                  tick={tick}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={50}
                />
                <YAxis
                  tick={tick}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  domain={[0, 'auto']}
                />
                <Tooltip
                  labelFormatter={(value) => formatTime(Number(value))}
                  formatter={(value) => [
                    `${Number(value).toFixed(1)} ms`,
                    'Avg latency',
                  ]}
                  contentStyle={tooltipStyle}
                />
                <Line
                  type="monotoneX"
                  dataKey="latency"
                  name="Avg latency"
                  stroke="var(--foreground)"
                  strokeWidth={1.5}
                  dot={{ r: 1.5, fill: 'var(--foreground)', strokeWidth: 0 }}
                  connectNulls={false}
                  isAnimationActive={false}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </section>
  );
});
