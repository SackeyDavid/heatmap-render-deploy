// One row per stable error code, plus a generic fallback. Source: B-merchant-surface.md section 4.5.
// `said` = what happened. `next` = the plain next step. Never blame the merchant for our-side problems.
// The server's own `message` is never used as a headline for these codes.

export interface ErrorRow {
  said: string;
  next: string;
}

export const ERROR_ROWS: Record<string, ErrorRow> = {
  // Codes the HTTP layer can send for POST/GET /v1/requests
  unauthenticated: { said: 'Please sign in to continue.', next: 'Open this page again from your Heatmap account.' },
  'reauth-required': {
    said: 'For your safety, please sign in again. Your words are saved.',
    next: 'Open this page again from your Heatmap account.',
  },
  forbidden: {
    said: "You can't do this on this website.",
    next: 'Ask a website owner to give you access.',
  },
  'not-found': { said: "We couldn't find that. It may have been deleted.", next: 'Start a new one.' },
  'payload-too-large': {
    said: 'That is too big.',
    next: 'Shorten your words or paste a smaller saved copy of your page.',
  },
  'unsupported-media-type': {
    said: 'We can only use saved web pages.',
    next: 'Choose a different saved page.',
  },
  'private-key-pattern': {
    said: 'That looks like a private Klaviyo key.',
    next: 'Take it out and use the short 6-character public key.',
  },
  'rate-limited': {
    said: "You're going a little fast.",
    next: 'Please wait a moment, then try again.',
  },
  'cap-open-requests': {
    said: 'You have too many unfinished requests.',
    next: 'Wait for one to finish, then try again.',
  },
  'cap-runs': {
    said: "You've reached today's limit for setting up tracking.",
    next: 'Come back tomorrow.',
  },
  'cap-refinements': {
    said: "You've made the most changes we allow on one request.",
    next: 'Start a new one.',
  },
  'quota-exceeded': { said: "You've used all your storage.", next: 'Delete old requests, then try again.' },
  maintenance: { said: "We're doing quick maintenance. Your words are saved.", next: 'Try again in a few minutes.' },
  internal: {
    said: 'Something went wrong on our side. Nothing was changed on your website.',
    next: 'Try again. If it keeps happening, ask our team.',
  },
  'engine-incident': {
    said: "We hit a problem on our side. Nothing was changed on your website. This isn't something you did.",
    next: 'Try again. If it keeps happening, ask our team.',
  },
  'invalid-request': {
    said: "We couldn't use what you sent. Nothing was changed on your website.",
    next: 'Check your words, page addresses and key, then try again.',
  },
  'invalid-prompt': {
    said: 'Please say a bit more about what you want to track.',
    next: 'Use at least ten characters and no more than four thousand.',
  },
  'invalid-page-addresses': {
    said: 'Please add between one and ten page addresses.',
    next: 'Each address should start with http:// or https://.',
  },
  'invalid-public-key': {
    said: 'The Klaviyo public key should be exactly six letters or numbers.',
    next: 'Find it in your Klaviyo account settings.',
  },
  'invalid-operation': {
    said: 'That partner choice is not available on this server.',
    next: 'Pick Klaviyo or custom partner on the form. Or ask your team which partners are enabled.',
  },
  'invalid-partner-destination': {
    said: 'Use a short lowercase partner name.',
    next: 'Example: custom-partner. Ask your developer if you are not sure.',
  },
  'invalid-saved-pages': {
    said: "We couldn't use one of your saved pages.",
    next: 'Check each has an address and some page content.',
  },
  'saved-page-too-large': {
    said: 'One of your saved pages is too large.',
    next: 'Save a smaller page and try again.',
  },
  'invalid-email': {
    said: "That email address doesn't look right.",
    next: 'Check it and try again.',
  },
  'email-required': {
    said: 'Please tell us which email to send the result to.',
    next: 'Add your email on the form.',
  },
  'wrong-environment': {
    said: 'This sign-in is not for this copy of the app.',
    next: 'Open this page again from your Heatmap account.',
  },
  'method-not-allowed': {
    said: "That action isn't supported here.",
    next: 'Refresh the page and try again.',
  },
  'validate-failed': {
    said: "We couldn't confirm Klaviyo is set up on your site yet. Nothing was changed on your website.",
    next: 'Check that Klaviyo is installed, then try again.',
  },
  'inspect-failed': {
    said: "We couldn't open one of your pages. Nothing was changed on your website.",
    next: 'Make sure each page is public and the address is right, then try again.',
  },
  'confirm-failed': {
    said: "We couldn't work out what to track from your description. Nothing was changed on your website.",
    next: 'Try describing the button or part of your page in a different way.',
  },
  'reader-unavailable': {
    said: "We couldn't read your description just now. Nothing was changed on your website.",
    next: 'Please try again in a few minutes.',
  },
  'invalid-approval': {
    said: "We couldn't use your answer. Nothing was changed on your website.",
    next: 'Send your request again and check what we understood.',
  },
  'not-awaiting-approval': {
    said: 'That request is not waiting for you any more.',
    next: 'Start a new one if you still need it.',
  },
  'generate-failed': {
    said: "We couldn't build tracking from your description. Nothing was changed on your website.",
    next: 'Try describing the button or part of your page in a different way.',
  },
  'qa-failed': {
    said: "What we built didn't pass our automatic checks, so we didn't turn it on. Nothing was changed on your website.",
    next: 'Try describing what you want to track in simpler terms.',
  },
  'publish-failed': {
    said: "We couldn't save your work. Nothing was changed on your website.",
    next: 'Try again in a few minutes.',
  },
  'verify-failed': {
    said: "We couldn't confirm it works, so we didn't turn it on. Nothing was changed on your website.",
    next: 'Try again.',
  },
  'notify-failed': {
    said: "Your tracking code is ready, but we couldn't send the confirmation email.",
    next: 'You can still use the test names shown on this page.',
  },
  'site-not-verified': {
    said: "We haven't checked that this is your website yet.",
    next: 'Ask our team to check it with you.',
  },
  'site-revoked': { said: 'Tracking for this website has been paused by our team.', next: 'Ask our team.' },
  'site-held': {
    said: 'We paused this for you.',
    next: 'Ask our team if you want it turned back on.',
  },
  'page-not-on-site': {
    said: "That page isn't on your website.",
    next: 'Use a page from your own website.',
  },
  'needs-sandbox': {
    said: 'This one needs a closer look from our team.',
    next: 'Ask our team.',
  },
  'scan-limit': {
    said: 'That page is very large or complicated, so we could not read it.',
    next: 'Save a simpler page and add it again.',
  },
  csrf: { said: 'Something went wrong with your sign-in.', next: 'Refresh the page.' },
  // Rules that can come back on a failed result
  'no-behaviour': {
    said: "We couldn't tell what you want to track.",
    next: 'Describe an action, like "when someone clicks Add to cart".',
  },
  'no-match': { said: "We couldn't find that on your page.", next: 'Add a fresh saved copy of your page and try again.' },
  'no-selector': {
    said: "We couldn't tell which button or part of your page you mean.",
    next: 'Name the button the way it appears on your page.',
  },
  'no-name': { said: "We couldn't come up with a clear name for this one.", next: 'Change your words and try again.' },
  'clarify-exhausted': { said: "We still aren't sure what you mean.", next: 'Change your words, or ask our team.' },
  'catalog-changed': {
    said: 'Your page changed since you saved a copy.',
    next: 'Add a fresh saved copy and try again.',
  },
  'already-published': { said: 'This is already set up.', next: 'Look for the email we sent you.' },
  'run-locked': { said: "We're already setting this up.", next: 'This page will update by itself.' },
  'run-lock-stale': { said: "Setting this up was interrupted. We're picking it back up.", next: 'Try again in a few minutes.' },
  'stale-job': { said: 'That set-up is out of date, so we stopped it. Nothing was changed.', next: 'Start again.' },
  'command-error': { said: "Something didn't work, and nothing was changed on your website.", next: 'Try again.' },
  'request-busy': { said: "We're still saving your last change.", next: 'Try again in a moment.' },
  // Problems on the way to our service (no code from the server)
  network: {
    said: "We couldn't reach our service. Nothing was changed on your website.",
    next: 'Check your internet connection, then try again.',
  },
  'bad-response': {
    said: 'We got an answer we could not read. Nothing was changed on your website.',
    next: 'Try again. If it keeps happening, ask our team.',
  },
  expired: {
    said: 'This was left unfinished for a while, so we closed it.',
    next: 'Start a new one.',
  },
};

/** Any code without a row above lands here. */
export const FALLBACK_ROW: ErrorRow = {
  said: "Something didn't work, and nothing was changed on your website.",
  next: 'Try again. If it keeps happening, ask our team.',
};

/** Rate limit with a known wait. Template; {n} is a whole number of seconds. */
export const RATE_LIMIT_WITH_SECONDS: ErrorRow = {
  said: "You're going a little fast.",
  next: 'Please wait {n} seconds, then try again.',
};

/** Codes that mean "sign in again", so the app shows the sign-in screen. */
export const SIGN_IN_CODES: readonly string[] = ['unauthenticated', 'reauth-required'];

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function errorRow(code: string, retryAfterSec?: number): ErrorRow {
  if (code === 'rate-limited' && retryAfterSec && retryAfterSec > 0) {
    return { said: RATE_LIMIT_WITH_SECONDS.said, next: fill(RATE_LIMIT_WITH_SECONDS.next, { n: retryAfterSec }) };
  }
  return ERROR_ROWS[code] ?? FALLBACK_ROW;
}

/**
 * Turns a test tag like "add_to_cart" into plain words: "add to cart". This is only the label; the real name
 * ("add_to_cart") must be shown next to it, because that exact name is what the merchant searches for in Klaviyo.
 */
export function plainTag(tag: string): string {
  const words = tag.replace(/[_\-.:]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words || tag;
}

/** A test tag as the merchant sees it: the plain label, and the exact name to search for (never altered). */
export function tagParts(tag: string): { label: string; exact: string; suffix?: string } {
  // A tag the build adds in brackets at the end ("(adapter)") is shown as written, not turned into a plain label.
  const m = /^(.*?) \(([a-z0-9][a-z0-9-]*)\)$/.exec(tag);
  if (m) return { label: plainTag(m[1]!), exact: tag, suffix: `(${m[2]})` };
  return { label: plainTag(tag), exact: tag };
}
