/**
 * Largest saved page we accept, in bytes of UTF-8 text. One owner: the HTTP layer refuses a bigger upload at the door and
 * the saved-html page inspector uses the same number as its default (the manifest may lower it for the inspector).
 */
export const MAX_SAVED_PAGE_BYTES = 3_000_000;
