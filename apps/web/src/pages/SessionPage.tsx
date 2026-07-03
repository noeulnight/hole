import { useParams } from 'react-router-dom';
import SessionStream from '../components/SessionStream';

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();

  if (!sessionId) {
    return null;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <SessionStream sessionId={sessionId} />
    </main>
  );
}
