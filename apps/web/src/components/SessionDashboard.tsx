import SessionStream from '@/components/SessionStream';

export default function SessionDashboard() {
  const sessionId = window.location.pathname.split('/')[2] ?? '';
  let decodedId = sessionId;
  try {
    decodedId = decodeURIComponent(sessionId);
  } catch {
    /* Keep malformed URL input safely encoded in the API request. */
  }
  return sessionId ? (
    <SessionStream sessionId={decodedId} />
  ) : (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Choose a session</h1>
      <a href="/" className="underline">
        Return to overview
      </a>
    </div>
  );
}
