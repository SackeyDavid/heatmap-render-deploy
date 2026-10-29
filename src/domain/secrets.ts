/**
 * What a private Klaviyo key looks like. One owner: the logger redacts it, the request schemas refuse it, the contract lint
 * rejects it in generated files. No \b: letters or "_" before the key must not hide it (abc_pk_..., xpk_...).
 */
export const PRIVATE_KEY_RE = /pk_[A-Za-z0-9_]{6,}/i;
/** Same pattern for replacing every occurrence. */
export const PRIVATE_KEY_RE_ALL = /pk_[A-Za-z0-9_]{6,}/gi;
/** Looser: anything that starts like a private key, even a short one (used for the "public key" field, which must never be one). */
export const PRIVATE_KEY_PREFIX_RE = /pk_/i;
