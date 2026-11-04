export function normalizeHost(hostHeader?: string): string | undefined {
  if (!hostHeader) return;

  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
