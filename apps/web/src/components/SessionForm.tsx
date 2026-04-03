import { FormEvent, useEffect, useState } from 'react';

export default function SessionForm({
  initialValue,
  onSubmit,
}: {
  initialValue: string;
  onSubmit: (sessionId: string) => void;
}) {
  const [sessionInput, setSessionInput] = useState(initialValue);

  useEffect(() => {
    setSessionInput(initialValue);
  }, [initialValue]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sessionId = sessionInput.trim();
    if (!sessionId) {
      return;
    }

    onSubmit(sessionId);
  }

  return (
    <form className="session-form" onSubmit={handleSubmit}>
      <label className="session-field">
        <span>Session ID</span>
        <input
          name="sessionId"
          value={sessionInput}
          onChange={(event) => setSessionInput(event.target.value)}
          placeholder="Paste a session id"
        />
      </label>
      <button type="submit">Open session</button>
    </form>
  );
}
