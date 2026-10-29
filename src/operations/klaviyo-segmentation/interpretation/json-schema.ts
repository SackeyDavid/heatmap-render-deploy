import { z } from "zod";
import { modelInterpretationSchema } from "./schema.ts";

/** The interpretation as JSON Schema, for a prompt (the server-side agent) and for the browser helper's constrained decoding. */
export const interpretationJsonSchema = z.toJSONSchema(modelInterpretationSchema);
