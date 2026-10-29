---
name: klaviyo-onsite-events
description: >-
  Generate Klaviyo onsite JavaScript that tracks clicks, scroll depth, form
  start/submit/abandon, and video or review engagement, plus the Klaviyo
  segment conditions those events support. Use when the user asks for a
  Klaviyo snippet, onsite event script, click/scroll/video tagging script, or
  a segment of people who did or did not complete an on-page action.
---

<!-- v2: derived from Kenn's v1 skill (see ../klaviyo-onsite-events@v1). Changes marked "v2". -->

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
3. One `track(eventName, properties)` helper, copied exactly from the examples (v2):
   - `var HM_SCRIPT_VERSION = "{{SCRIPT_VERSION}}";` once, at the top of `start()`. Leave the placeholder as is; the pipeline stamps it at publish.
   - `console.log("[Heatmap>Klaviyo]", eventName, HM_SCRIPT_VERSION)`
   - Hand the event to Heatmap: `if (typeof window._fireCustomEvent === "function") window._fireCustomEvent(eventName, "klaviyo");`
   - Keep the `properties` parameter so call sites stay unchanged. Heatmap's call takes only the event name, so properties are not sent.
4. Keep event names the user asked for. Otherwise use `snake_case`. **Event names must be known without running the script** (checked mechanically): the first argument of `track()` (and of any helper you write that passes its name on to `track()`) is a string literal, a concatenation of literals, or `rule.event` read from a rule table you declare in the script (`var CLICK_EVENTS = [{ selector: "...", event: "clicked_x" }, ...]`, as the Manduu and JellyBee samples do). Never build a name from the page: no `.value`, `textContent`, `getAttribute`, `location`, storage reads, loop counters, or a variable assigned from any of those. At most 50 distinct names, each at most 80 characters, and every name must also be in `segments.json`.
5. Wrap every listener body (and `checkScroll`) in `try { ... } catch (err) {}` so a broken selector can never break the merchant's page (v2).

## Heatmap hand-off (v2)

The script records behavior; Heatmap owns delivery to Klaviyo. Source: Fortune's "Firing a Heatmap conversion event from your own code".

- The only allowed transport is `window._fireCustomEvent(eventName, "klaviyo")`, called from `track()` and nowhere else.
- Heatmap fires each event name once per visitor per visit. A repeated name in the same visit does nothing, so give milestones their own names (e.g. `faq_opened_1`, `faq_opened_5`) instead of counting on repeats.
- The call never throws and returns `true` or `false`.
- Anonymous visitors still record the event in Heatmap; Klaviyo only receives it when the visitor arrived through a Klaviyo email.

## Forbidden (v2, checked mechanically)

- Any direct Klaviyo access: `klaviyo.track`, `klaviyo.push`, `window.klaviyo`, `_learnq`, any Klaviyo host.
- `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, dynamic `<script>` injection, `eval`, `new Function`.
- `localStorage` and cookies. `sessionStorage` keys start with a short site prefix (e.g. `scs_`).
- Reading email, phone, payment or password fields. Never read form values the request does not name.
- Any string that looks like a private key (`pk_...`).
- Modern syntax: write ES5 (`var`, `function`), no arrow functions, `let`, `const`, template strings or spread. Keep the file under 15 KB.

## Allowed constructs (v2, closed world, checked mechanically)

The lint is an allowlist: anything not listed here fails, with a message naming it. Stay inside this list; the three samples already do.

- Syntax: `var`, function declarations and expressions, `if`, `for`, `return`, `try/catch`, `break`, `continue`, object and array literals, `+ - * / %`, comparisons, `&& || ! typeof`, `= += -= ++ --`. No `this`, `switch`, `throw`, `for..in`, labels, comma expressions, getters, `delete`, `in`, `instanceof`.
- Globals: `window` (only `addEventListener`, `matchMedia`, `getComputedStyle`, `scrollY`, `innerHeight`, `location.pathname|origin|search|href`, and the `track()` hand-off), `document` (`addEventListener`, `documentElement`, `readyState`, `body`, `querySelector`, `querySelectorAll`, `getElementById`), `location` (read `pathname`, `origin`, `search`, `href` only), `sessionStorage` (`getItem`, `setItem`, `removeItem`, site-prefixed keys), `console.log`, `JSON.parse|stringify`, `Math.abs|floor|round`, `new URL(href, base)`, `Array.prototype.slice.call(list)`.
- On elements, events and values: read `target` (never `currentTarget`), `touches`, `changedTouches`, `clientX`, `clientY`, `nodeType`, `nodeName`, `tagName`, `parentElement`, `id`, `name`, `text`, `textContent`, `innerText`, `disabled`, `options`, `selectedIndex`, `value`, `classList`, `length`, `scrollHeight`, `display`, `visibility`, `width`, `height`, `bottom`, `left`, `right`, `pathname`, `origin`. Call `closest`, `matches`, `contains`, `getAttribute`, `querySelector`, `querySelectorAll`, `getBoundingClientRect`, `forEach`, `filter`, `indexOf`, `slice`, `concat`, `join`, `split`, `trim`, `replace(/regex/, text)`, `toLowerCase`, `toUpperCase`, `charAt`, `substring`, `test`, and `push` on your own arrays.
- Assignment only to variables, and to properties of your own plain objects and arrays (`seen[name] = 1`). Never assign to an element, `document`, `window` or `location` property (no `innerHTML`, `src`, `href`, `style`, `setAttribute`).
- Loops: only `for (var i = 0; i < list.length; i++)` or `for (var i = 0; i < 25; i++)` with a numeric literal bound of at most 1000, a counter that the body does not change, and at most two levels of nesting. No `while`, no `do..while`, no recursion (direct or mutual). Regex literals may not repeat a group that contains an alternation or another quantifier (`(a|b)+`, `(a+)+`, `(.*a){25}`), may not use counted repeats above 20 or more than 4 unbounded quantifiers, and may not use backreferences. Do not build a string or array from itself, directly or through a temporary, an alias or a helper (`s + s`, `s.concat(s)`, `s = f(s)`, `t = a.concat(b); a = t; b = t;`): any variable that is rebuilt from its own contents more than once per pass is refused, and long chains of copies are refused by a size estimate. Never call `addEventListener` inside another listener, inside a loop or `forEach`, or in a helper they call; register listeners once in `start()` and delegate from `document` (check `event.target`). Selectors may not use `iframe`, `:autofill`, `inputmode`, `data-stripe`-style attributes, or an `input`/`select` inside a checkout, login, billing or payment container. No invisible or control characters (bidirectional marks, zero-width characters, BOM, U+2028) and no `/*@cc_on` comments, even inside comments; `.replace(/x/g, text)` takes a replacement of at most one character, `.split(a).join(b)` needs literals with b no longer than a, numeric indexes stay at or below 1000, `join` takes no argument or a literal of at most 4 characters, `Array.prototype.slice.call` takes only a `querySelectorAll(...)` result, no object literal has a `length` key, and `sessionStorage.setItem` is not called in a loop. Selectors may not point at `script` elements or `[src]`, nor at ids, classes or names that read as email, phone, password, card, ssn or social fields. Refused outright: `try/finally`, HTML comment markers (`<!--`, `-->`), `</script`, `sourceMappingURL` comments, `javascript:`/`data:` URLs, and sessionStorage keys built from page data.
- Selectors passed to `querySelector`, `querySelectorAll`, `closest` and `matches` must be constants (a literal, a concatenation of literals, or `rule.selector` from your rule table), and may not target password, card, email, phone or hidden inputs (including by `^=`, `*=`, `$=`, `|=`, `~=` patterns on `type`, `name`, `autocomplete`, `id` or `class`).
- Computed access only as `arr[i]` with a numeric index, or `obj[key]` on a variable that only ever holds your own plain data. No timers (`setTimeout`, `setInterval`), no `new` of anything but `URL`, no `.call/.apply/.bind`.

## Output files (v2)

Write all three to the output folder:

- `script.js`: the snippet.
- `segments.json`: `{ "events": [{ "name", "trigger", "once", "pages" }], "segments": [{ "name", "conditions" }] }`. Every event the script emits is listed, and every listed event appears in the script.
- `notes.md`: assumptions, selectors chosen and why, and anything in the request you could not implement.

## What to emit

| User intent | Behavior |
|---|---|
| Tag a click | Fire on every matching click (Heatmap counts the first per visit). |
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

## Install prerequisite

Klaviyo.js must be on the site so Heatmap can read the visitor's Klaviyo ID. See [klaviyo-js-install-guide.md](klaviyo-js-install-guide.md). Only the 6-character Public API Key ever goes on a site.

## Examples

- [examples/manduu-clicks-scroll.js](examples/manduu-clicks-scroll.js) — named clicks that do not navigate, plus scroll milestones
- [examples/jellybee-clicks-scroll.js](examples/jellybee-clicks-scroll.js) — user-supplied selectors, video plays, a reviews region, plus scroll milestones
- [examples/seatcoversolutions-vehicle-videos-reviews.js](examples/seatcoversolutions-vehicle-videos-reviews.js) — form start, submit, and abandon, unique-video milestones, a tab switch, and the heavy-consumption segment
