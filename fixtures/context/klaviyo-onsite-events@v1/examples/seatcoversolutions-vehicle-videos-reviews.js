// seatcoversolutions.com
// Vehicle selector: started, submitted, abandoned.
// Homepage videos: first unique video, second unique video, fifth unique video.
// Photo Reviews tab: once per visit, only when that tab is not already active.
//
// Segments this script supports:
// - Started, did not submit: has done vehicle_selector_abandoned and has not
//   done vehicle_selector_submitted since that abandon.
// - Submitted: has done vehicle_selector_submitted at least once.
// - Heavy video and review consumption (last 30 days): has done
//   homepage_videos_five_or_more AND has done switched_to_photo_reviews.
//
// Guide: visible fields only, capture-phase submit before navigation,
// sessionStorage so replays and refreshes do not double-count.

(function () {
  function start() {
    var STARTED_KEY = "scs_vehicle_started";
    var SUBMITTED_KEY = "scs_vehicle_submitted";
    var VIDEOS_KEY = "scs_videos_watched";
    var REVIEWS_KEY = "scs_switched_reviews";

    function track(eventName, properties) {
      var klaviyo = window.klaviyo = window.klaviyo || [];
      var payload = properties || {};
      payload.page_url = location.href;
      payload.page_path = location.pathname;
      console.log("[Klaviyo]", eventName, payload);
      if (typeof klaviyo.track === "function") {
        klaviyo.track(eventName, payload);
      } else {
        klaviyo.push(["track", eventName, payload]);
      }
    }

    function isHome() {
      var path = location.pathname.replace(/\/+$/, "");
      return path === "" || path === "/";
    }

    function isVisible(el) {
      var node = el;
      while (node && node !== document.documentElement) {
        var cs = window.getComputedStyle(node);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    }

    function widgets() {
      return Array.prototype.slice.call(
        document.querySelectorAll(".vehicle-menu-container, .select-your-vehicle, .scs-cle-ymm")
      ).filter(isVisible);
    }

    function selects(widget) {
      return Array.prototype.slice.call(widget.querySelectorAll("select")).filter(isVisible);
    }

    function chosen(select) {
      if (!select || select.disabled) return "";
      var value = (select.value || "").trim();
      if (!value) return "";
      var label = select.options[select.selectedIndex]
        ? select.options[select.selectedIndex].text.trim()
        : value;
      if (/^(year|make|model)$/i.test(label)) return "";
      return label;
    }

    function role(select) {
      var hint = ((select.getAttribute("aria-label") || "") + " " + (select.id || "") + " " + (select.name || "")).toLowerCase();
      if (hint.indexOf("year") !== -1) return "year";
      if (hint.indexOf("make") !== -1) return "make";
      if (hint.indexOf("model") !== -1) return "model";
      return "";
    }

    function snapshot(from) {
      var data = { year: "", make: "", model: "" };
      var root = from && from.closest
        ? from.closest(".vehicle-menu-container, .select-your-vehicle, .scs-cle-ymm")
        : null;
      var list = root ? selects(root) : [];
      if (!list.length) {
        widgets().forEach(function (widget) { list = list.concat(selects(widget)); });
      }
      list.forEach(function (select) {
        var key = role(select);
        var value = chosen(select);
        if (key && value) data[key] = value;
      });
      data.fields_completed = ["year", "make", "model"].filter(function (key) { return !!data[key]; }).length;
      return data;
    }

    function markStarted(from) {
      if (sessionStorage.getItem(STARTED_KEY) === "1") return;
      var data = snapshot(from);
      if (!data.fields_completed) return;
      sessionStorage.setItem(STARTED_KEY, "1");
      sessionStorage.removeItem(SUBMITTED_KEY);
      track("vehicle_selector_started", data);
    }

    function markSubmitted(from) {
      var data = snapshot(from);
      if (data.fields_completed < 3) return;
      sessionStorage.setItem(SUBMITTED_KEY, "1");
      if (sessionStorage.getItem(STARTED_KEY) !== "1") {
        sessionStorage.setItem(STARTED_KEY, "1");
        track("vehicle_selector_started", data);
      }
      track("vehicle_selector_submitted", data);
    }

    function watchedIds() {
      try { return JSON.parse(sessionStorage.getItem(VIDEOS_KEY) || "[]"); }
      catch (e) { return []; }
    }

    function videoId(card) {
      return (card.getAttribute("aria-label") || card.getAttribute("data-video") || "").trim();
    }

    function markVideo(card) {
      var id = videoId(card);
      if (!id) return;
      var ids = watchedIds();
      if (ids.indexOf(id) !== -1) return;
      ids.push(id);
      sessionStorage.setItem(VIDEOS_KEY, JSON.stringify(ids));
      var payload = {
        video: id.replace(/^Play video review from\s*/i, ""),
        videos_watched: ids.length
      };
      if (ids.length === 1) track("homepage_video_watched", payload);
      if (ids.length === 2) track("homepage_videos_multiple", payload);
      if (ids.length === 5) track("homepage_videos_five_or_more", payload);
    }

    function markPhotoReviews() {
      if (sessionStorage.getItem(REVIEWS_KEY) === "1") return;
      sessionStorage.setItem(REVIEWS_KEY, "1");
      track("switched_to_photo_reviews", { videos_watched: watchedIds().length });
    }

    document.addEventListener("change", function (e) {
      var select = e.target;
      if (!select || select.tagName !== "SELECT") return;
      if (!select.closest(".vehicle-menu-container, .select-your-vehicle, .scs-cle-ymm")) return;
      if (!isVisible(select) || !chosen(select)) return;
      markStarted(select);
    }, true);

    document.addEventListener("click", function (e) {
      var node = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
      if (!node || !node.closest) return;

      var button = node.closest("#vehicle-submit-button, .vehicle-button button");
      if (button && !button.disabled) markSubmitted(button);

      if (!isHome()) return;

      var card = node.closest(".td-card[aria-label^='Play video review']");
      if (card) markVideo(card);

      var tab = node.closest(".td-tab-btn");
      if (tab && /photo reviews/i.test(tab.textContent || "") && !tab.classList.contains("active")) {
        markPhotoReviews();
      }
    }, true);

    window.addEventListener("pagehide", function () {
      if (sessionStorage.getItem(STARTED_KEY) !== "1") return;
      if (sessionStorage.getItem(SUBMITTED_KEY) === "1") return;
      sessionStorage.setItem(SUBMITTED_KEY, "abandoned");
      track("vehicle_selector_abandoned", snapshot());
    });
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
