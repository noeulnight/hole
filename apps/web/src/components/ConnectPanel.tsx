import { useState } from 'react';
import { ArrowUpRight, Check, Copy, Terminal } from 'lucide-react';
import SessionForm from '@/components/SessionForm';
import { Button } from '@/components/ui/button';

export default function ConnectPanel() {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );
  const command = 'ssh tunnel.lth.so -R0:127.0.0.1:3000';
  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid lg:grid-cols-[1.3fr_1fr]">
        <section className="min-w-0 border-b p-5 sm:p-6 lg:border-r lg:border-b-0">
          <div className="mb-5 flex items-center gap-2 text-sm font-semibold">
            <Terminal className="size-4" aria-hidden="true" /> New tunnel
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2.5">
            <span
              className="pl-1 font-mono text-xs text-muted-foreground"
              aria-hidden="true"
            >
              $
            </span>
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1 font-mono text-xs">
              {command}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Copy SSH command"
              onClick={() => {
                void copyCommand();
              }}
            >
              {copyState === 'copied' ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
          <p
            className={
              copyState === 'error'
                ? 'mt-2 text-xs text-destructive'
                : 'sr-only'
            }
            role="status"
          >
            {copyState === 'error'
              ? 'Copy failed.'
              : copyState === 'copied'
                ? 'Copied.'
                : ''}
          </p>
        </section>
        <section className="min-w-0 p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-2 text-sm font-semibold">
            <ArrowUpRight className="size-4" aria-hidden="true" /> Session
            inspector
          </div>
          <SessionForm
            initialValue=""
            onSubmit={(id) => {
              window.location.href = `/session/${encodeURIComponent(id)}`;
            }}
          />
        </section>
      </div>
    </div>
  );
}
