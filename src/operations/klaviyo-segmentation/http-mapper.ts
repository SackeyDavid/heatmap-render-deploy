import { PLAIN } from "../../domain/plain-messages.ts";
import { PRIVATE_KEY_PREFIX_RE } from "../../domain/secrets.ts";
import type { MappedRequest, OperationRequestMapper, RequestFacts } from "../../ports/index.ts";
import { inferPlatform } from "../shared/infer-platform.ts";
import { leftOutFromNotes } from "../shared/left-out.ts";
import { SECRET_LIKE } from "../shared/secret-like.ts";
import { testTagsFromSegments } from "../shared/test-tags.ts";
import { validateInterpretation } from "./interpretation/validate.ts";
import { klaviyoSegmentationInput } from "./operation.ts";

/** A key longer than this is treated as a private key (the merchant screen agrees). */
export const MAX_PUBLIC_KEY_CHARS = 20;

const bad = (code: string, message: string): MappedRequest => ({ ok: false, code, message });
const PRIVATE_KEY_MESSAGE = "That looks like a private Klaviyo key. Please use the 6-character Public API Key instead, and remove any private key from your description.";
const PUBLIC_KEY_MESSAGE = "The Klaviyo Public API Key should be exactly 6 letters or numbers.";

/** How an HTTP request becomes the Klaviyo operation's input; this operation owns its own fields and their checks. */
export const klaviyoRequestMapper: OperationRequestMapper = {
  errorCodes: ["invalid-prompt", "invalid-public-key", "private-key-pattern", "invalid-email", "invalid-request"],
  testTagsFile: "segments.json",
  testTags: testTagsFromSegments,
  leftOutFile: "notes.md",
  leftOut: leftOutFromNotes,
  failureMessage(kind, code) {
    if (kind !== "validate") return undefined;
    return code === "integration-not-connected"
      ? "We couldn't confirm that Klaviyo is connected to Heatmap for your site. Please connect it, then try again. Nothing was changed on your site."
      : "We couldn't confirm that Klaviyo is set up on your site yet. Please check that it is installed, then try again. Nothing was changed on your site.";
  },
  map(facts: RequestFacts, body: Record<string, unknown>): MappedRequest {
    const publicKey = body.publicKey;
    if (typeof publicKey !== "string") return bad("invalid-public-key", PUBLIC_KEY_MESSAGE);
    if (PRIVATE_KEY_PREFIX_RE.test(publicKey) || publicKey.length > MAX_PUBLIC_KEY_CHARS) return bad("private-key-pattern", PRIVATE_KEY_MESSAGE);

    if (SECRET_LIKE.test(facts.prompt)) return bad("private-key-pattern", PRIVATE_KEY_MESSAGE);

    const candidate = {
      siteId: facts.siteId,
      publicKey,
      pages: facts.pageUrls,
      description: facts.prompt,
      platform: inferPlatform(facts.siteId, facts.pageUrls),
      notifyEmail: facts.notifyEmail,
    };
    // The operation's own schema is the one validator; map its first complaint to a stable code and a plain message.
    const parsed = klaviyoSegmentationInput.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const field = issue.path[0];
      if (field === "publicKey") return bad("invalid-public-key", PUBLIC_KEY_MESSAGE);
      if (field === "description") return bad("invalid-prompt", PLAIN.prompt);
      if (field === "notifyEmail") return bad("invalid-email", PLAIN.email);
      return bad("invalid-request", PLAIN.generic);
    }

    // What a model read from the description (the in-browser helper): checked here and again against the page. One that does not hold
    // up is treated as absent, so the server-side interpreter (if the manifest has one) reads the description instead, or the request
    // is refused with "we need the helper". The merchant's prose itself is never parsed here.
    let proposal: ReturnType<typeof validateInterpretation> | undefined;
    if (body.interpretation !== undefined && body.interpretation !== null) proposal = validateInterpretation(body.interpretation, facts.prompt, facts.pageUrls);
    const usable = proposal?.ok && !(proposal.interpretation.behaviours.length === 0 && proposal.dropped.some((d) => d.reason === "interpretation-schema"));
    const modelInterpretation = proposal?.ok && usable ? proposal.interpretation : undefined;
    // A reading that came but could not be used at all: the helper exists, so the answer is "try again", not "turn the helper on".
    const unreadable = proposal !== undefined && !usable;
    const artifacts: { name: string; text: string }[] = [];
    if (modelInterpretation) artifacts.push({ name: "proposal.json", text: `${JSON.stringify(modelInterpretation, null, 2)}\n` });
    // `approval` is never read from the body: only the approve route (approve() below) and the operator CLI set it.
    return { ok: true, input: { ...candidate, ...(modelInterpretation ? { modelInterpretation } : {}), ...(unreadable ? { interpretationUnreadable: true } : {}) }, artifacts };
  },
  approve(stored, body) {
    const interpretation = body.interpretation;
    if (typeof interpretation !== "object" || interpretation === null || Array.isArray(interpretation)) return { ok: false, code: "invalid-approval", message: "We couldn't use that approval. Please look at what we understood and approve it again." };
    const { approval: _old, ...rest } = stored;
    return { ok: true, input: { ...rest, approval: { interpretation, by: "merchant" } } };
  },
};
