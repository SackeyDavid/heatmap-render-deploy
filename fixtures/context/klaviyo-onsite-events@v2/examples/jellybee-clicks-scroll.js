// thejellybee.com — user-supplied selectors kept verbatim.
// Discount YES, three video play buttons (click on the control or its children),
// any click inside the reviews carousel, plus scroll depth.
// Guide: do not "improve" a selector the user pasted. closest() covers children.

(function () {
  function start() {
    var HM_SCRIPT_VERSION = "{{SCRIPT_VERSION}}";
    var CLICK_EVENTS = [
      {
        selector: "body > div:nth-child(93) > div > div:nth-child(2) > div > div > div > div > div > form > div > div:nth-child(2) > div > button",
        event: "clicked_discount_yes"
      },
      {
        selector: "#w-root > div > div.vw-cmp__carousel--root > div > div > div.keen-slider--root.vw-embla__viewport > div > div:nth-child(1) > div > div.vw-cmp__in-video-card--preview > div.vw-cmp__in-video-card-button.vw-cmp__video-card--play-icon.vw-cmp__icon-size--medium.vw-cmp__icon-position--center.STANDARD.needsclick",
        event: "watched_Lakeia_Smith_video"
      },
      {
        selector: "#w-root > div > div.vw-cmp__carousel--root > div > div > div.keen-slider--root.vw-embla__viewport > div > div:nth-child(2) > div > div.vw-cmp__in-video-card--preview > div.vw-cmp__in-video-card-button.vw-cmp__video-card--play-icon.vw-cmp__icon-size--medium.vw-cmp__icon-position--center.STANDARD.needsclick",
        event: "watched_turmeric_video"
      },
      {
        selector: "#w-root > div > div.vw-cmp__carousel--root > div > div > div.keen-slider--root.vw-embla__viewport > div > div:nth-child(3) > div > div.vw-cmp__in-video-card--preview > div.vw-cmp__in-video-card-button.vw-cmp__video-card--play-icon.vw-cmp__icon-size--medium.vw-cmp__icon-position--center.STANDARD.needsclick",
        event: "watched_collagen_video"
      },
      {
        selector: "#reviews > div > div.jdgm-carousel-wrapper",
        event: "engaged_with_reviews"
      }
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
