import type { ReactNode } from 'react';

/** Muted empty / none-yet copy (success test panel, etc.). */
export function EmptyStateNote({ children }: { children: ReactNode }) {
  return <p className="hm-empty-state">{children}</p>;
}
