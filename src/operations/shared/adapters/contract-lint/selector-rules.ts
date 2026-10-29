// Rules for CSS selector strings that a script passes to querySelector / querySelectorAll / closest / matches.
// The selector itself must be statically known (see name-flow.ts); this file judges its text.
//
// HEURISTIC, NOT A PROOF. A selector can reach a sensitive field in ways this text check does not see (for
// example by position, `input:nth-child(3)`, or by a class name that happens to be on the password box).
// Since round 4 the value of such a field can no longer reach an event NAME (names are static), so this check is
// defence in depth for "never touch email, phone, payment or password fields", not the exfiltration control.

/** Attributes whose value says what kind of data an input holds. */
const KIND_ATTRIBUTES = new Set(["type", "name", "autocomplete", "id", "class", "inputmode", "placeholder"]);
/** Of those, the ones where an exact value is also judged (id/class exact values like #reviews are ordinary page hooks). */
const EXACT_ATTRIBUTES = new Set(["type", "name", "autocomplete"]);
const SENSITIVE_TYPES = new Set(["password", "email", "tel", "hidden"]);
/** A pattern (prefix, suffix, substring, word) that is a fragment of one of these could select such a field. */
const FRAGMENT_TERMS = ["password", "passwd", "passcode", "creditcard", "cardnumber", "cc-number", "cc-exp", "cc-csc", "cvv", "cvc", "email", "e-mail", "phone", "tel", "ssn", "iban", "current-password", "new-password", "one-time-code"];
/** A pattern that contains one of these could select such a field. */
const CONTAINED_TERMS = ["password", "passwd", "passcode", "creditcard", "cardnumber", "card-number", "card_number", "cc-", "cvv", "cvc", "ssn", "email", "e-mail", "phone", "iban"];
/** Exact attribute values (name/autocomplete) that are sensitive. */
const EXACT_VALUES = new Set(["mail", "pwd", "pass", "cc", "card", "tel", "phone", "email"]);

/**
 * Words that, as a whole part of an id, class, name, autocomplete or placeholder value (split on - _ . space and camelCase),
 * mark a field that holds something private: user_email, phoneNumber, billing-ssn, cc_cvv.
 */
const SENSITIVE_PARTS = new Set([
  "email", "password", "passwd", "passcode", "pwd", "ssn", "cvv", "cvc", "iban", "passport", "creditcard", "cardnumber", "phone", "telephone",
  "dob", "birthdate", "birthday", "routing", "secret", "tel", "otp", "pw", "cardnum", "ccnum", "ccexp", "cccsc", "cardexp", "expiry", "expdate",
]);
/** Joined-name fragments (after removing separators) that mark a payment or password field: cc-exp, ccNum, card_cvc, user-pw ... */
const SENSITIVE_JOINED = ["creditcard", "cardnumber", "socialsecurity", "email", "password", "passwd", "passcode", "telephone", "passport", "birthdate", "birthday", "ccexp", "ccnum", "cccsc", "cccvc", "cccvv", "cardexp", "cardnum", "cardcvc", "cardcvv", "cardcode", "securitycode", "expirydate", "expirationdate"];
/** Part words of a container (form, wrapper) that holds sensitive fields. An input under one of these is refused. */
const CONTEXT_PARTS = new Set(["checkout", "payment", "billing", "login", "signin", "signup", "register", "credential", "credentials", "auth", "authentication", "account", "shipping", "address", "paypal", "stripe", "braintree", "recurly", "adyen", "newsletter", "subscribe"]);
/** Attribute names (data-*) that mark payment-provider or card fields; refused with or without a value. */
const SENSITIVE_DATA_ATTRIBUTE = /^data-(stripe|braintree|recurly|adyen|payment|card|cc|cvc|cvv|credit|secure)/;
/** Part words that only matter on form-field attributes (name, autocomplete, id), where they are field names; as a class they are ordinary words (.social-links). */
const FIELD_ONLY_PARTS = new Set(["social", "mail", "pass", "cc", "token", "birth", "security", "tax"]);

const ATTRIBUTE = /\[([^\]]*)\]/g;

const partsOf = (value: string): string[] =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** True when a value (an id, a class, a name) names a private field. fieldAttr: the value is from name/autocomplete/id/placeholder, so the field-only words count too. */
function sensitiveName(value: string, fieldAttr: boolean): string | undefined {
  const parts = partsOf(value).map((p) => p.replace(/\d+$/, "") || p); // pw1, email2, pass3
  for (const p of parts) if (SENSITIVE_PARTS.has(p) || (fieldAttr && FIELD_ONLY_PARTS.has(p))) return p;
  const joined = parts.join("");
  for (const t of SENSITIVE_JOINED) if (joined.includes(t)) return t;
  // pass-ish field names: userpass, passInput, loginPw (field attributes only: "bypass" or "compass" as a class is not a field)
  if (fieldAttr && (/^pass(?!age|enger|port\b)/.test(joined) || (/(pass|pw)$/.test(joined) && !/(com|by|over|under|tres|sur|encom)pass$/.test(joined)))) return "pass";
  return undefined;
}

/** Returns a description of what is wrong with the selector, or undefined when it is acceptable. */
export function selectorProblem(selector: string): string | undefined {
  if (selector.length > 500) return "selector is longer than 500 characters";
  const lower = selector.toLowerCase();
  // Selectors that point at script elements: <script>, script[src*=...], [src=...]. A script's text or URL is page-controlled data.
  const bare = lower.replace(/\[[^\]]*\]/g, "[]").replace(/"[^"]*"|'[^']*'/g, "");
  if (/(^|[\s,>+~(*:])script(?![\w-])/.test(bare)) return "selects <script> elements, whose text and src are page-controlled data (inline scripts often hold tokens and customer data); the lint does not allow reading them";
  if (/\[\s*src\b/.test(lower)) return "selects by the src attribute, which is how script and image URLs are probed; use another hook";
  // Frames hold payment and login forms (Stripe, hosted fields, SSO); their contents are not ours to select, and the frame element itself is the hook for probing them.
  if (/(^|[\s,>+~(*:])(iframe|frame|frameset|embed|object)(?![\w-])/.test(bare)) return "selects a frame or embedded object (payment and sign-in forms often live in frames); the lint does not allow it";
  // Browser autofill pseudo-classes select exactly the fields the browser filled with saved personal and card data.
  if (/autofill/.test(lower)) return "uses an autofill pseudo-class, which selects the fields the browser filled with saved personal and payment data";
  // Numeric-entry and payment-provider markers
  if (/\[\s*inputmode\b/.test(lower)) return "selects by inputmode; numeric and tel inputs are card numbers, codes and phone numbers";
  for (const m of lower.matchAll(/\[\s*(data-[a-z0-9_-]+)/g)) if (SENSITIVE_DATA_ATTRIBUTE.test(m[1]!)) return `[${m[1]}] marks a payment-provider or card field`;
  // An input, textarea or select under a checkout / login / payment style container (form.checkout input.x, #login input)
  const fieldTag = /(^|[\s,>+~(*])(input|textarea|select)(?![\w-])/.test(bare);
  // #id and .class tokens (outside attribute brackets and quotes) that name a private field
  for (const m of selector.replace(/\[[^\]]*\]/g, "[]").replace(/"[^"]*"|'[^']*'/g, "").matchAll(/([#.])([A-Za-z_][\w-]*)/g)) {
    const hit = sensitiveName(m[2]!, m[1] === "#");
    if (hit) return `${m[0]} names a private field ("${hit}"); never capture email, phone, payment, password or similar fields`;
    if (fieldTag) {
      const ctx = partsOf(m[2]!).find((p) => CONTEXT_PARTS.has(p));
      if (ctx) return `${m[0]} is a ${ctx} container and the selector also picks an input, textarea or select; fields in checkout, login, billing and account forms are private`;
    }
  }
  const attributes: { attr: string; op: string; value: string; raw: string }[] = [];
  for (const m of lower.matchAll(ATTRIBUTE)) {
    // Quotes, spaces and '+' are dropped so that [type='pass'+'word'] and [type=password i] read as their content.
    const inner = (m[1] ?? "").replace(/['"\s+]/g, "");
    const parts = /^([a-z][\w-]*)([~|^$*]?=)?(.*)$/.exec(inner);
    attributes.push({ attr: parts?.[1] ?? "", op: parts?.[2] ?? "", value: parts?.[3] ?? "", raw: m[0] });
  }
  for (const a of attributes) {
    if (!KIND_ATTRIBUTES.has(a.attr) || a.op === "") continue;
    const v = a.value;
    if (a.op === "=") {
      const fieldHit = (a.attr === "id" || a.attr === "class" || a.attr === "name" || a.attr === "autocomplete" || a.attr === "placeholder") && sensitiveName(a.value, a.attr !== "class");
      if (fieldHit) return `${a.raw} names a private field ("${fieldHit}"); never capture email, phone, payment, password or similar fields`;
      if (!EXACT_ATTRIBUTES.has(a.attr)) continue;
      if (a.attr === "type" && [...SENSITIVE_TYPES].some((t) => v.startsWith(t))) return `${a.raw} selects a sensitive input type (${[...SENSITIVE_TYPES].join(", ")})`;
      if (a.attr !== "type" && (EXACT_VALUES.has(v) || CONTAINED_TERMS.some((t) => v.includes(t)))) return `${a.raw} selects a sensitive field by ${a.attr}`;
      continue;
    }
    // ^= $= *= |= ~= : a pattern, so judge what it could match.
    const fragmentOfTerm = v.length > 0 && FRAGMENT_TERMS.some((t) => t.includes(v));
    const containsTerm = CONTAINED_TERMS.some((t) => v.includes(t));
    if (fragmentOfTerm || containsTerm) return `${a.raw} uses a pattern operator (${a.op}) on "${a.attr}" with a value that could match a password, card, email, phone or similar field; use an exact selector or name the element another way`;
  }
  if (/:not\(/.test(lower) && attributes.some((a) => a.attr === "type" || a.attr === "name" || a.attr === "autocomplete")) {
    return "a :not([type|name|autocomplete ...]) selector selects everything else, including password and payment fields";
  }
  return undefined;
}

// ---------- click-hook selectors (what a script passes to closest() / matches())
//
// closest() and matches() decide WHICH clicks fire an event, so a selector that matches nearly everything ("*", "body",
// "html", "body:has(a)") turns every click into the event, and one that names a javascript: link is a probe. These are
// accepted only in the forms the builder and the hand-written samples use: element names, #id, .class, [attribute],
// :nth-child-style positions, joined by a space or ">" and listed with commas. Everything else (":has", ":is", ":where",
// "+", "~", escapes) is refused. A selector that is only "html", "body" or "*" at its end is refused even when it has a
// parent (closest() matches ancestors, so "body" always matches).

const ATTR_PART = String.raw`\[\s*[A-Za-z][\w-]*\s*(?:[~|^$*]?=\s*(?:'[^'\\]*'|"[^"\\]*"|[A-Za-z0-9_-]+)(?:\s+[iIsS])?)?\s*\]`;
const POSITION_PART = String.raw`:(?:(?:nth-child|nth-of-type)\(\s*\d+\s*\)|first-child|last-child|first-of-type|last-of-type)`;
const SIMPLE_PART = String.raw`(?:#[A-Za-z_][\w-]*|\.[A-Za-z_][\w-]*|${ATTR_PART}|${POSITION_PART})`;
const COMPOUND = new RegExp(String.raw`^([A-Za-z][A-Za-z0-9-]*)?((?:${SIMPLE_PART})*)$`);

/** Splits on a character outside quotes, brackets and parentheses. */
function splitTop(text: string, separators: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    if (!quote && depth === 0 && separators.includes(ch)) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Returns what is wrong with a click-hook selector, or undefined when it is one of the accepted forms. */
export function triggerSelectorProblem(selector: string): string | undefined {
  if (/javascript\s*:|vbscript\s*:/i.test(selector)) return "names a javascript: address; a click hook must not point at script links";
  if (selector.trim() === "") return "is empty";
  for (const alternative of splitTop(selector, ",")) {
    const text = alternative.trim();
    if (text === "") return "has an empty part";
    if (/\*(?![^\[]*\])/.test(text.replace(/'[^']*'|"[^"]*"/g, ""))) return "uses the universal selector *, which matches every click";
    if (/:(?:has|is|where|not|matches|host|root)\b/i.test(text)) return "uses a structural pseudo-class (:has, :is, :where, :not ...); name the element by tag, id, class or attribute";
    // Compounds are separated by ">" or by spaces outside brackets and quotes.
    const compounds = splitTop(text.replace(/\s*>\s*/g, " > "), " ").filter((c) => c !== "");
    const parts = compounds.filter((c) => c !== ">");
    if (parts.length === 0 || compounds[0] === ">" || compounds[compounds.length - 1] === ">") return "has a misplaced '>'";
    for (let i = 1; i < compounds.length; i++) if (compounds[i] === ">" && compounds[i - 1] === ">") return "has a misplaced '>'";
    for (const c of parts) {
      if (!COMPOUND.test(c)) return `has a part this check does not accept (${c.slice(0, 40)}): use element names, #id, .class, [attribute='value'] and :nth-child(n) only`;
    }
    const last = COMPOUND.exec(parts[parts.length - 1]!)!;
    const tag = (last[1] ?? "").toLowerCase();
    if (tag === "html" || tag === "body") return `ends in <${tag}>, which every click is inside; that would fire on every click`;
    if (!tag && !/[#.[]/.test(last[2] ?? "")) return "does not say which element it means";
  }
  return undefined;
}
