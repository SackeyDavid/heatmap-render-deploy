import { screens } from './screens';
import { ERROR_ROWS, FALLBACK_ROW, RATE_LIMIT_WITH_SECONDS } from './errors';
import { modelCopy } from './model';

export { screens } from './screens';
export * from './errors';

/** Every merchant-visible string, for the copy-lint test. */
export function allCopyStrings(): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(screens);
  walk(ERROR_ROWS);
  walk(FALLBACK_ROW);
  walk(RATE_LIMIT_WITH_SECONDS);
  walk(modelCopy);
  return out;
}
