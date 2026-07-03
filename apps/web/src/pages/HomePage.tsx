import { useState } from 'react';

import { Button } from '@/components/ui/button';

export default function HomePage() {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );

  function handleCopy() {
    void navigator.clipboard
      .writeText('ssh tunnel.lth.so -R0:127.0.0.1:3000')
      .then(() => {
        setCopyState('copied');
      })
      .catch(() => {
        setCopyState('error');
      });
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-3xl space-y-7">
        <div className="space-y-4">
          <h1 className="title-font max-w-3xl text-5xl font-semibold tracking-normal text-balance sm:text-7xl">
            Expose local services over SSH.
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
            Run the command below to start the tunnel.
          </p>
        </div>

        <div className="grid gap-3 border-y py-4 sm:grid-cols-[1fr_auto]">
          <code className="flex min-h-12 items-center overflow-x-auto font-mono text-sm text-primary">
            ssh tunnel.lth.so -R0:127.0.0.1:3000
          </code>
          <Button
            className="h-12"
            type="button"
            onClick={() => handleCopy()}
            variant={copyState === 'error' ? 'destructive' : 'default'}
          >
            {copyState === 'copied'
              ? 'Copied'
              : copyState === 'error'
                ? 'Copy failed'
                : 'Copy'}
          </Button>
        </div>
      </section>
    </main>
  );
}
