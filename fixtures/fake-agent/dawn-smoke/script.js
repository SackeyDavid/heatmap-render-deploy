// Dawn smoke fixture for Shopify dev-store lane (heatmap-oauth-dev + theme dev preview).
// Events: add to cart, newsletter signup, contact form submit, collection/product views.

(function () {
  function start() {
    var VERSION = "{{SCRIPT_VERSION}}";
    var TAGS_KEY = "{{siteSlug}}_tags";

    function track(eventName) {
      if (!eventName) return;
      console.log("[Heatmap>Klaviyo]", eventName, VERSION);
      if (typeof window._fireCustomEvent === "function") window._fireCustomEvent(eventName, "klaviyo");
    }

    function sent() {
      try {
        return JSON.parse(sessionStorage.getItem(TAGS_KEY) || "{}");
      } catch (e) {
        return {};
      }
    }

    function once(eventName) {
      var done = sent();
      if (done[eventName]) return;
      done[eventName] = 1;
      try {
        sessionStorage.setItem(TAGS_KEY, JSON.stringify(done));
      } catch (e) {}
      track(eventName);
    }

    function pathBase() {
      var path = location.pathname || "/";
      return path.replace(/\/+$/, "") || "/";
    }

    function pageView() {
      var path = pathBase();
      if (path.indexOf("/products/") === 0) once("viewed_product");
      else if (path.indexOf("/collections/") === 0) once("viewed_collection");
    }

    document.addEventListener(
      "click",
      function (e) {
        try {
          var node = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
          if (!node || !node.closest) return;
          if (node.closest('button[name="add"].product-form__submit, .quick-add__submit')) once("add_to_cart");
        } catch (err) {}
      },
      true
    );

    document.addEventListener(
      "submit",
      function (e) {
        try {
          var form = e.target;
          if (!form || !form.classList) return;
          if (form.classList.contains("newsletter-form")) once("newsletter_signup");
          if (form.id === "ContactForm") once("contact_form_submitted");
        } catch (err) {}
      },
      true
    );

    pageView();
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
