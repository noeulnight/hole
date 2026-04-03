import { useState } from 'react';

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
    <main className="title-shell">
      <section className="hero title-stack">
        <h1>Expose local services over SSH.</h1>
        <p className="lede">Run the command below to start the tunnel.</p>
        <div className="command-row">
          <code className="command-block">
            ssh tunnel.lth.so -R0:127.0.0.1:3000
          </code>
          <button
            className="copy-button"
            type="button"
            onClick={() => handleCopy()}
          >
            {copyState === 'copied'
              ? 'Copied'
              : copyState === 'error'
                ? 'Copy failed'
                : 'Copy'}
          </button>
        </div>
      </section>
    </main>
  );
}
