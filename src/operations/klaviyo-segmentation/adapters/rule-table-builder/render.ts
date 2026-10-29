import { BUILDER_SCRIPT_MARKER } from "../../../shared/builder-script-marker.ts";
import type { EventPlan } from "./event-plan.ts";
import { safeLabel } from "./safe-text.ts";

/** The part of a plan the renderers read. */
export type RenderablePlan = Pick<EventPlan, "clicks" | "scrolls" | "notes" | "notTracked" | "pages">;

/**
 * Plan -> the three output files. The script is the v2 Manduu sample shape (rule tables read by a click
 * listener and a scroll checker). Plan values enter the script only as JSON string/number literals inside
 * the two tables; every other character is a constant of this file. A table is emitted only when it has rows
 * (the lint rejects an empty table).
 */

const VERSION_LINE = `    var HM_SCRIPT_VERSION = "{{SCRIPT_VERSION}}";`;

const TRACK = `    function track(eventName, properties) {
      if (!eventName) return false;
      console.log("[Heatmap>Klaviyo]", eventName, HM_SCRIPT_VERSION);
      if (typeof window._fireCustomEvent !== "function") return false;
      window._fireCustomEvent(eventName, "klaviyo");
      return true;
    }`;

const CLICK_BODY = `    document.addEventListener("click", function (e) {
      try {
        var node = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
        if (!node || !node.closest) return;

        CLICK_EVENTS.forEach(function (rule) {
          try {
            var match = node.closest(rule.selector);
            if (!match) return;
            track(rule.event, {
              selector: rule.selector,
              element_text: (match.innerText || match.getAttribute("aria-label") || "").trim().slice(0, 120)
            });
          } catch (ruleErr) {}
        });
      } catch (err) {}
    }, true);`;

const SCROLL_BODY = `    function scrollPercent() {
      var doc = document.documentElement;
      var scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return 0;
      return (window.scrollY / scrollable) * 100;
    }

    var fired = {};
    function checkScroll() {
      try {
        var pct = scrollPercent();
        SCROLL_EVENTS.forEach(function (rule) {
          if (fired[rule.percent] || pct + 0.5 < rule.percent) return;
          // Marked as done only when Heatmap got the event; if its helper is not loaded yet, the next scroll tries again.
          if (track(rule.event, { scroll_percent: rule.percent })) fired[rule.percent] = true;
        });
      } catch (err) {}
    }

    // Only real scroll events count: nothing fires at load, on a page too short to scroll, or for a restored scroll position.
    window.addEventListener("scroll", checkScroll, { passive: true });`;

const q = (s: string) => JSON.stringify(s).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
/** Page labels in notes.md / segments.json: the same safe character set as every other message (no markup, addresses, quotes or code-like dots). */
const plain = (s: string) => safeLabel(s, 120).replace(/[()]/g, " ").replace(/\s+/g, " ").trim();

export function renderScript(plan: RenderablePlan): string {
  const parts: string[] = [VERSION_LINE];
  if (plan.clicks.length > 0) {
    parts.push(`    var CLICK_EVENTS = [\n${plan.clicks.map((c) => `      { selector: ${q(c.selector)}, event: ${q(c.event)} }`).join(",\n")}\n    ];`);
  }
  if (plan.scrolls.length > 0) {
    parts.push(`    var SCROLL_EVENTS = [\n${plan.scrolls.map((s) => `      { percent: ${String(Math.trunc(s.percent))}, event: ${q(s.event)} }`).join(",\n")}\n    ];`);
  }
  parts.push(TRACK);
  if (plan.clicks.length > 0) parts.push(CLICK_BODY);
  if (plan.scrolls.length > 0) parts.push(SCROLL_BODY);
  return `${BUILDER_SCRIPT_MARKER} Events go to Klaviyo only through Heatmap.
(function () {
  function start() {
${parts.join("\n\n")}
  }

  if (document.readyState === "complete") {
    start();
  } else {
    window.addEventListener("load", start);
  }
})();
`;
}

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
};

export function renderSegments(plan: RenderablePlan): string {
  const pages = [...new Set(plan.pages.map(pathOf))];
  const events = [
    ...plan.clicks.map((c) => ({ name: c.event, trigger: `A visitor clicks "${plain(c.label)}"`, once: "session", pages })),
    ...plan.scrolls.map((s) => ({ name: s.event, trigger: `A visitor scrolls ${s.percent}% of the way down the page`, once: "session", pages })),
  ];
  const segments = events.map((e) => ({ name: `Did: ${e.name}`, conditions: `Has done ${e.name} at least once in the last 30 days` }));
  return JSON.stringify({ events, segments }, null, 2) + "\n";
}

export function renderNotes(plan: RenderablePlan): string {
  const lines = [
    "# Notes",
    "",
    "Built by the rule-table builder from an interpretation of your request that a model produced and you approved. Fixed code (not a model) checked each name against the saved page, chose the selectors and wrote this script.",
    "**Read this whole file before installing.** It lists what was built and, under \"Not tracked\", everything in the request the builder could not build. Those parts are NOT in the script.",
    "",
  ];
  if (plan.clicks.length > 0) {
    lines.push("## Clicks");
    for (const c of plan.clicks) lines.push(`- **${c.event}**: "${plain(c.label)}", selected by \`${c.selector}\` (${c.why}).`);
    lines.push("");
  }
  if (plan.scrolls.length > 0) {
    lines.push("## Scroll depth", ...plan.scrolls.map((s) => `- **${s.event}**: fires once per page load when ${s.percent}% of the page has been scrolled.`), "");
  }
  if (plan.notes.length > 0) lines.push("## Matching notes", ...plan.notes.map((n) => `- ${n}`), "");
  lines.push("## Behavior to know", "- Heatmap fires each event name once per visitor per visit; repeat clicks do not fire again.", "- Only the event name is sent to Klaviyo (no properties).", "- Events reach Klaviyo only for visitors Heatmap can identify (arrived from a Klaviyo email).", "- Load this script AFTER the Heatmap snippet; calls made before it loads are dropped.", "");
  if (plan.notTracked.length > 0) lines.push("## Not tracked (not supported by this builder)", ...plan.notTracked.map((n) => `- ${n}`), "");
  return lines.join("\n");
}
