/** True when the UI talks to a loopback API (local Track 2 stack). */
export function usesLocalStackApi(): boolean {
  const base = import.meta.env.VITE_API_BASE?.trim() || 'http://127.0.0.1:8787';
  try {
    const host = new URL(base).hostname;
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
}
