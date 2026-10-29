/** Neutralise closing-tag injection in merchant text (parity with server guard; simplified). */
export function fenceMerchantRequest(text: string): string {
  return text
    .replace(/<\s*\/\s*merchant_request\s*>/gi, "< /merchant_request>")
    .replace(/<\s*merchant_request\s*>/gi, "< merchant_request>");
}
