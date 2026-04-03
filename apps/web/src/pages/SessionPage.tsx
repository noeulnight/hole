import { useParams } from 'react-router-dom';
import SessionStream from '../components/SessionStream';

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();

  if (!sessionId) {
    return null;
  }

  return (
    <main className="shell dashboard-shell">
      <header className="dashboard-brand">
        <span>Hole</span>
      </header>
      <SessionStream sessionId={sessionId} />
    </main>
  );
}
