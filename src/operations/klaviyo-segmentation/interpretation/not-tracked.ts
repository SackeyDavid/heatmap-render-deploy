import type { TriggerKind, UnsupportedReason } from "./schema.ts";

/**
 * Fixed merchant-facing wording for every "not tracked" reason. The model's own words (evidence) are never shown, so a model (or a
 * hostile request that reached it) cannot put text of its own into a message in the product's voice.
 */
export const NOT_TRACKED_LABEL: Record<Exclude<UnsupportedReason, "exclusion">, string> = {
  own_event_name: "your own event names",
  count: "counting clicks or opens",
  condition: "conditions between actions",
  page_limit: "limiting to one page or device",
  visitor_filter: "limiting to certain visitors, such as ones from a country or a source",
  first_time: "only the first time (each event already fires once per visit, not once ever per person)",
  faq_specific: "one specific FAQ question (every FAQ opening is tracked together)",
  faq_close: "closing an FAQ question (only opening is tracked)",
  hover: "hovering over a button or link (only clicks are tracked)",
  keyboard: "pressing keyboard keys (only clicks are tracked)",
  window_change: "changes to the browser window (such as minimizing, resizing or refreshing it)",
  leaving_page: "leaving or closing the page or tab",
  double_click: "double clicks and right clicks",
  long_press: "long presses and middle clicks",
  tab_switch: "tab switches",
  video_play: "video plays",
  form_activity: "form start, submit or abandon",
  cart: "cart, checkout or purchase",
  time_delay: "time delays",
  time_on_page: "time on page",
  page_view: "page views",
  typing: "typing in a text field (a click rule cannot see what is typed, and text fields are not tracked)",
  visitor_details: "details about the visitor (such as country or device)",
  scroll_other: "a scroll request other than a depth of the page (such as scrolling back up, a distance in pixels or a range)",
  other_language: "words in a language or alphabet we could not read",
  unreadable: "a part of what you wrote that we could not read",
  not_understood: "words we could not make sense of",
  in_view: "an element coming into view",
  value_capture: "reading what a visitor types or chooses",
  other_site: "another website",
  not_an_action: "something that is not an action a visitor takes",
  other: "something this builder cannot track yet",
};

/** Reasons that mean the merchant wanted part of the page LEFT OUT or an exact variant; they make the note about unapplied modifiers appear. */
export const MODIFIER_REASONS: ReadonlySet<UnsupportedReason> = new Set(["own_event_name", "count", "condition", "page_limit", "visitor_filter", "first_time"]);

/** Kinds that are accepted from a model only so they can be reported: the script cannot record them. */
export const KIND_NOT_TRACKED: Partial<Record<TriggerKind, string>> = {
  form_start: NOT_TRACKED_LABEL.form_activity,
  form_submit: NOT_TRACKED_LABEL.form_activity,
  form_abandon: NOT_TRACKED_LABEL.form_activity,
  video_play: NOT_TRACKED_LABEL.video_play,
  tab_switch: NOT_TRACKED_LABEL.tab_switch,
};

/** One plain sentence in notes.md whenever any of the MODIFIER_REASONS was in the request. */
export const MODIFIER_NOTE =
  "Your request had a name of your own for an event, a count (such as \"after 5\" or \"more than once\"), a condition (such as \"only after they scroll\") or a page or device limit. None of those are applied: this builder names events itself, and each event listed above fires on its own, once per visit, on every page the script is installed on.";
