import { PLAIN } from "../../domain/plain-messages.ts";
import type { MappedRequest, OperationRequestMapper, RequestFacts } from "../../ports/index.ts";
import { inferPlatform } from "../shared/infer-platform.ts";
import { leftOutFromNotes } from "../shared/left-out.ts";
import { SECRET_LIKE } from "../shared/secret-like.ts";
import { testTagsFromSegments } from "../shared/test-tags.ts";
import { genericHeatmapEventsInput } from "./operation.ts";

const bad = (code: string, message: string): MappedRequest => ({ ok: false, code, message });
const DESTINATION_MESSAGE = "The partner destination should be 2–32 lowercase letters, numbers, or hyphens (example: custom-partner).";

/** How an HTTP request becomes the generic partner-events operation's input. */
export const genericRequestMapper: OperationRequestMapper = {
  errorCodes: ["invalid-prompt", "invalid-partner-destination", "private-key-pattern", "invalid-email", "invalid-request"],
  testTagsFile: "segments.json",
  testTags: testTagsFromSegments,
  leftOutFile: "notes.md",
  leftOut: leftOutFromNotes,
  map(facts: RequestFacts, body: Record<string, unknown>): MappedRequest {
    if (SECRET_LIKE.test(facts.prompt)) return bad("private-key-pattern", PLAIN.privateKey);
    const partnerDestination = typeof body.partnerDestination === "string" ? body.partnerDestination.trim() : "";
    const candidate = {
      siteId: facts.siteId,
      partnerDestination,
      pages: facts.pageUrls,
      description: facts.prompt,
      platform: inferPlatform(facts.siteId, facts.pageUrls),
      notifyEmail: facts.notifyEmail,
    };
    const parsed = genericHeatmapEventsInput.safeParse(candidate);
    if (!parsed.success) {
      const field = parsed.error.issues[0]!.path[0];
      if (field === "partnerDestination") return bad("invalid-partner-destination", DESTINATION_MESSAGE);
      if (field === "description") return bad("invalid-prompt", PLAIN.prompt);
      if (field === "notifyEmail") return bad("invalid-email", PLAIN.email);
      return bad("invalid-request", PLAIN.generic);
    }
    return { ok: true, input: candidate };
  },
};
