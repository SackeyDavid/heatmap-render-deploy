// manduu.com — clicks that stay on the page, plus scroll depth.
// Search opens an overlay. Each Learn More opens a video modal.
// Guide: named click events, capture-phase closest(), scroll fired once per milestone.

(function () {
  function start() {
    var HM_SCRIPT_VERSION = "{{SCRIPT_VERSION}}";
    var CLICK_EVENTS = [
      { selector: "a.fusion-main-menu-icon[aria-label='Search']", event: "Clicked Search" },
      { selector: "a.button-2[data-target='.fusion-modal.fitvideo']", event: "Clicked 15 Minutes to Fit" },
      { selector: "a.button-3[data-target='.fusion-modal.emsvideo']", event: "Clicked Full Body EMS Workout" },
      { selector: "a.button-4[data-target='.fusion-modal.fitnessvideo']", event: "Clicked Fitness for Everyone" }
    ];

    var SCROLL_EVENTS = [
      { percent: 50, event: "Scrolled 50 Percent" },
      { percent: 100, event: "Scrolled 100 Percent" }
    ];

    function track(eventName, properties) {
      if (!eventName) return;
      console.log("[Heatmap>Klaviyo]", eventName, HM_SCRIPT_VERSION);
      if (typeof window._fireCustomEvent === "function") window._fireCustomEvent(eventName, "klaviyo");
    }

    function scrollPercent() {
      var doc = document.documentElement;
      var scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return 100;
      return (window.scrollY / scrollable) * 100;
    }

    document.addEventListener("click", function (e) {
      try {
        var node = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
        if (!node || !node.closest) return;

        CLICK_EVENTS.forEach(function (rule) {
          var match = node.closest(rule.selector);
          if (!match) return;
          track(rule.event, {
            selector: rule.selector,
            element_text: (match.innerText || match.getAttribute("aria-label") || "").trim().slice(0, 120)
          });
        });
      } catch (err) {}
    }, true);

    var fired = {};
    function checkScroll() {
      try {
        var pct = scrollPercent();
        SCROLL_EVENTS.forEach(function (rule) {
          if (fired[rule.percent] || pct + 0.5 < rule.percent) return;
          fired[rule.percent] = true;
          track(rule.event, { scroll_percent: rule.percent });
        });
      } catch (err) {}
    }

    window.addEventListener("scroll", checkScroll, { passive: true });
    checkScroll();
  }

  if (document.readyState === "complete") {
    start();
  } else {
    window.addEventListener("load", start);
  }
})();
