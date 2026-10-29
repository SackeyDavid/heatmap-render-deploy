/**
 * The first line of every script the rule-table builder writes. The contract lint reads it to know the script claims to come
 * from the builder, and then holds it to the builder's own naming (see builderEventNameProblem). A script that does not carry
 * the line is checked by the general rules only; one that carries it without being the builder's only gets stricter checks.
 */
export const BUILDER_SCRIPT_MARKER = "// Generated for Heatmap from the merchant's description.";

export const isBuilderScript = (script: string): boolean => script.startsWith(BUILDER_SCRIPT_MARKER);

/** Names the builder emits (Title Case): "Clicked <label>", "Scrolled <n> Percent", and the one fixed FAQ name "Opened FAQ". The label allows letters, digits, spaces and ' & - (at most 64: the label's 60 plus a " NN" uniqueness suffix); a repeated scroll or FAQ name may carry the same suffix. */
export const BUILDER_EVENT_NAME = /^(?:Clicked [A-Za-z0-9][A-Za-z0-9 &'-]{0,63}|Scrolled \d{1,3} Percent(?: \d{1,2})?|Opened FAQ(?: \d{1,2})?)(?: \([a-z0-9][a-z0-9-]{0,29}\))?$/;

/** An optional short tag (lower-case letters, digits, hyphens) that the builder adds in brackets to every event name, e.g. "Scrolled 50 Percent (kenn-test)". Off unless the request asks for it. */
export const EVENT_TAG = /^[a-z0-9][a-z0-9-]{0,29}$/;
