import { useEffect, useState } from 'react';

interface ConnectionCounts {
  sessions: number;
  tunnels: number;
}

export default function ServerStatus() {
  const [counts, setCounts] = useState<ConnectionCounts | null>(null);
  const [state, setState] = useState<'loading' | 'online' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch('/api/status', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Status unavailable');
        const result = (await response.json()) as ConnectionCounts;
        if (controller.signal.aborted) return;
        setCounts(result);
        setState('online');
      } catch {
        if (controller.signal.aborted) return;
        setCounts(null);
        setState('error');
      }
      timer = setTimeout(() => {
        void refresh();
      }, 5000);
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  return (
    <section aria-label="Server connections" className="border-t">
      <span className="sr-only" role="status">
        {state === 'online'
          ? 'Online'
          : state === 'error'
            ? 'Unavailable'
            : 'Connecting'}
      </span>
      <dl className="grid grid-cols-2 divide-x">
        <div className="px-5 py-5">
          <dt className="text-xs text-muted-foreground">Sessions</dt>
          <dd className="mt-2 font-mono text-3xl font-medium tabular-nums">
            {counts?.sessions ?? '—'}
          </dd>
        </div>
        <div className="px-5 py-5">
          <dt className="text-xs text-muted-foreground">Tunnels</dt>
          <dd className="mt-2 font-mono text-3xl font-medium tabular-nums">
            {counts?.tunnels ?? '—'}
          </dd>
        </div>
      </dl>
    </section>
  );
}
