export const parsePortRange = (
  value: string,
): { min: number; max: number } | null => {
  const match = value.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;

  const min = parseInt(match[1], 10);
  const max = parseInt(match[2], 10);
  if (min >= max || min < 1 || max > 65535) return null;
  return { min, max };
};
