import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    <form
      className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
      onSubmit={handleSubmit}
    >
      <label className="grid gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          Session ID
        </span>
        <Input
          name="sessionId"
          value={sessionInput}
          onChange={(event) => setSessionInput(event.target.value)}
          placeholder="Paste a session id"
        />
      </label>
      <Button className="h-10" type="submit">
        Open session
        <ArrowRight aria-hidden="true" />
      </Button>
    </form>
  );
}
