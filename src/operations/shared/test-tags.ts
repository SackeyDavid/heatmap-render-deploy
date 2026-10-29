/** The event names a merchant can test, read from a published segments.json. Bad or missing data gives no names, never an error. */
export function testTagsFromSegments(fileText: string): string[] {
  try {
    const parsed = JSON.parse(fileText) as { events?: { name?: unknown }[] };
    return (parsed.events ?? [])
      .map((e) => e.name)
      .filter((n): n is string => typeof n === "string" && /^[A-Za-z][A-Za-z0-9_ '&-]{0,99}$/.test(n))
      .slice(0, 50);
  } catch {
    return [];
  }
}
