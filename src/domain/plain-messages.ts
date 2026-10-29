/**
 * Plain-language sentences that more than one layer shows a merchant (the HTTP layer and each operation's request mapper).
 * One owner, so the same mistake is never described two ways.
 */
export const PLAIN = {
  prompt: "Please describe what you want to track in a sentence or two (at least 10 characters, at most 4000).",
  email: "That email address doesn't look right. Please check it and try again.",
  generic: "Something in your request isn't quite right. Please check the form and try again.",
  privateKey: "That looks like a private key. Please remove it from your description and use only public details.",
} as const;
