---
name: klaviyo-onsite-events
description: >-
  Generate Klaviyo onsite JavaScript that tracks clicks, scroll depth, form
  start/submit/abandon, and video or review engagement, plus the Klaviyo
  segment conditions those events support. Use when the user asks for a
  Klaviyo snippet, onsite event script, click/scroll/video tagging script, or
  a segment of people who did or did not complete an on-page action.
---

# Klaviyo onsite event scripts

Write one paste-ready `<script>` the merchant can drop on a page. The snippet records behavior. It does not create the segment inside Klaviyo. When the user asks for a segment, also give the Klaviyo conditions that segment uses.

Read the closest file in [examples/](examples/) before writing. Match that shape. Do not invent a second helper style.

## Inspect first

Open the live page and confirm the controls before choosing selectors.

- Prefer `id`, `aria-label`, and stable classes.
- Use a selector the user pasted verbatim, even if it is brittle.
- Ignore copies that are `display: none` or `visibility: hidden`. Desktop and mobile duplicates are common.
- A click on a child counts. Match with `closest()`.
- Listen in the capture phase (`true`) so the event is recorded before the site navigates.

## Script shape

Every script follows the examples:

1. IIFE. Work starts in `start()`.
2. Run `start()` immediately when `document.readyState === "complete"`. Otherwise listen for `window` `load`.
3. One `track(eventName, properties)` helper:
   - `window.klaviyo = window.klaviyo || []`
   - Add `page_url` and `page_path`
   - `console.log("[Klaviyo]", eventName, payload)`
   - Call `klaviyo.track` when it is a function, otherwise `klaviyo.push(["track", eventName, payload])`
4. Keep event names the user asked for. Otherwise use `snake_case`.

## What to emit

| User intent | Behavior |
|---|---|
| Tag a click | Fire on every matching click. |
| Tag a person who did it | Fire once. Guard with `sessionStorage`. |
| Scroll 50% and 100% | Once each per page load. Depth is `scrollY / (scrollHeight - innerHeight) * 100`. A page that fits in the viewport is 100. Treat `pct + 0.5 >= threshold` as reached. Jumping to the bottom fires 50, then 100. |
| Started a form and did not submit | `*_started` on the first real value. `*_submitted` on the submit control while the required fields are filled. `*_abandoned` on `pagehide` only when started and not submitted. Set the submitted flag synchronously in the click handler, before navigation. Placeholder labels (`Year`, `Make`, `Model`) are not values. |
| Watched videos | Count unique videos, not replays. Fire the "watched" event at 1, "multiple" at 2, and "five or more" at 5. Store the id list in `sessionStorage`. |
| Switched to another tab | Fire once, and only when that tab is not already active. |

Homepage-only behavior (video grids, review tabs) must check the path. A form that appears on many pages stays site-wide.

## Segments

State the conditions in Klaviyo's terms. A useful window is the last 30 days.

- **Did the action:** has done the event at least once.
- **Started and did not submit:** has done `*_abandoned` and has not done `*_submitted` since that abandon.
- **Heavy video and review consumption:** has done the five-or-more video event and has done the photo-reviews event.

## Examples

- [examples/manduu-clicks-scroll.js](examples/manduu-clicks-scroll.js) — named clicks that do not navigate, plus scroll milestones
- [examples/jellybee-clicks-scroll.js](examples/jellybee-clicks-scroll.js) — user-supplied selectors, video plays, a reviews region, plus scroll milestones
- [examples/seatcoversolutions-vehicle-videos-reviews.js](examples/seatcoversolutions-vehicle-videos-reviews.js) — form start, submit, and abandon, unique-video milestones, a tab switch, and the heavy-consumption segment
