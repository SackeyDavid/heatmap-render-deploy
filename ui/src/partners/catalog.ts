/** Merchant-facing partner / operation choices (not a marketplace). */
export const OPERATION_KLAVIYO = 'klaviyo.segmentation-script' as const;
export const OPERATION_GENERIC = 'generic.heatmap-events' as const;

export type MerchantOperation = typeof OPERATION_KLAVIYO | typeof OPERATION_GENERIC;

export interface PartnerOption {
  operation: MerchantOperation;
  label: string;
  hint: string;
}

export const PARTNER_OPTIONS: PartnerOption[] = [
  {
    operation: OPERATION_KLAVIYO,
    label: 'Klaviyo',
    hint: 'Build audiences in Klaviyo from what visitors do. You will need your 6-character Klaviyo public key.',
  },
  {
    operation: OPERATION_GENERIC,
    label: 'Another tool',
    hint: 'Send what visitors do to a tool other than Klaviyo. Your developer or the tool gives you a short name to enter.',
  },
];

export function defaultOperationFromEnv(): MerchantOperation {
  const raw = import.meta.env.VITE_HEATMAP_OPERATION?.trim();
  if (raw === OPERATION_GENERIC) return OPERATION_GENERIC;
  return OPERATION_KLAVIYO;
}
