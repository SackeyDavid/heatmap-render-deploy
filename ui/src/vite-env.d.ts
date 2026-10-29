/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  /** Local Track 2: link to the site-registry sign-in page (plain anchor, not shown in production). */
  readonly VITE_LOCAL_SIGNIN_PAGE?: string;
  /** Optional link back to the Heatmap dashboard from the auth gateway. */
  readonly VITE_HEATMAP_DASHBOARD_URL?: string;
  /** Default partner operation when the form loads (matches server HEATMAP_HTTP_OPERATION). */
  readonly VITE_HEATMAP_OPERATION?: string;
  /** "1" when the server has its own reader for the words (manifests/http-local-claude.yaml), so a request may be sent without the helper. */
  readonly VITE_SERVER_READS?: string;
  /** auto (default: the in-browser helper) | webllm | mock (canned answers) | none (no helper: requests are not sent unless VITE_SERVER_READS=1). */
  readonly VITE_MERCHANT_MODEL?: string;
}
