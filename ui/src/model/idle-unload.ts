import type { ModelProvider } from './provider';

export const HIDDEN_UNLOAD_MS = 2 * 60_000;
export const IDLE_UNLOAD_MS = 10 * 60_000;

/**
 * Frees the model's memory when the tab is hidden for a while or the merchant has been idle (E 2.3 lifecycle).
 * The provider reloads on demand at the next submit (from the browser cache), so unloading is always safe.
 * Returns a function that stops watching.
 */
export function watchIdleUnload(
  provider: Pick<ModelProvider, 'unload'>,
  opts: { hiddenMs?: number; idleMs?: number; doc?: Document } = {},
): () => void {
  const doc = opts.doc ?? document;
  const hiddenMs = opts.hiddenMs ?? HIDDEN_UNLOAD_MS;
  const idleMs = opts.idleMs ?? IDLE_UNLOAD_MS;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const unload = () => void provider.unload().catch(() => undefined);
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(unload, idleMs);
  };
  const onVisibility = () => {
    if (hiddenTimer) clearTimeout(hiddenTimer);
    hiddenTimer = doc.visibilityState === 'hidden' ? setTimeout(unload, hiddenMs) : undefined;
    if (doc.visibilityState === 'visible') armIdle();
  };
  const events = ['pointerdown', 'keydown'] as const;
  for (const e of events) doc.addEventListener(e, armIdle);
  doc.addEventListener('visibilitychange', onVisibility);
  armIdle();

  return () => {
    if (hiddenTimer) clearTimeout(hiddenTimer);
    if (idleTimer) clearTimeout(idleTimer);
    for (const e of events) doc.removeEventListener(e, armIdle);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
