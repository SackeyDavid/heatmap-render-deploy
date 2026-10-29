(function () {
  function start() {
    var VERSION = "{{SCRIPT_VERSION}}";
    var TAGS_KEY = "{{siteSlug}}_tags";

    function track(eventName, properties) {
      if (!eventName) return;
      console.log("[Heatmap>Partner]", eventName, VERSION);
      if (typeof window._fireCustomEvent === "function") window._fireCustomEvent(eventName, "custom-partner");
    }

    function sent() {
      try { return JSON.parse(sessionStorage.getItem(TAGS_KEY) || "{}"); }
      catch (e) { return {}; }
    }

    function once(eventName) {
      var done = sent();
      if (done[eventName]) return;
      done[eventName] = 1;
      try { sessionStorage.setItem(TAGS_KEY, JSON.stringify(done)); } catch (e) {}
      track(eventName);
    }

    document.addEventListener("click", function (e) {
      try {
        var node = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
        if (node && node.closest && node.closest("summary, button.faq")) once("faq_opened");
      } catch (err) {}
    }, true);

    window.addEventListener("scroll", function () {
      try {
        var scrollable = document.documentElement.scrollHeight - window.innerHeight;
        var pct = scrollable <= 0 ? 100 : (window.scrollY / scrollable) * 100;
        if (pct + 0.5 >= 50) once("scrolled_50_percent");
      } catch (err) {}
    }, { passive: true });
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
