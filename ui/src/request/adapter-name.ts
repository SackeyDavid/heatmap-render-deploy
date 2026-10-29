import { OPERATION_KLAVIYO } from '../partners/catalog';
import type { FormValues } from './build';

/** The longest tool name shown in the failure page header. Longer names end with an ellipsis. */
export const ADAPTER_NAME_MAX = 24;

/** The name the form pre-fills for "Another tool"; the merchant has not named a tool yet. */
const PLACEHOLDER_DESTINATION = 'custom-partner';
export const FALLBACK_TOOL_NAME = 'Another tool';

/**
 * Turns the tool name the merchant typed (a short lowercase name such as "hub-spot" or "ga4") into a display name.
 * Letters and digits only, spaces collapsed, each word capitalised; a short word that holds a digit (ga4) is shown in capitals.
 * The result is plain text for React to escape; it is never used as markup. The original casing is not known, so "hubspot" shows as "Hubspot".
 */
export function formatToolName(raw: string): string {
  const words = raw
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  const shown = words
    .map((w) => (/\d/.test(w) && w.length <= 4 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
  const chars = Array.from(shown);
  return chars.length > ADAPTER_NAME_MAX ? `${chars.slice(0, ADAPTER_NAME_MAX - 1).join('').trimEnd()}…` : shown;
}

/** The tool the merchant chose on the form: "Klaviyo", or the formatted name of another tool, or "Another tool" when unnamed. */
export function adapterName(v: Pick<FormValues, 'operation' | 'partnerDestination'>): string {
  if (v.operation === OPERATION_KLAVIYO) return 'Klaviyo';
  const raw = v.partnerDestination.trim();
  if (raw === '' || raw === PLACEHOLDER_DESTINATION) return FALLBACK_TOOL_NAME;
  return formatToolName(raw) || FALLBACK_TOOL_NAME;
}
