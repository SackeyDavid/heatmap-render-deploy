/**
 * Local stand-in for Heatmap's page snippet (development only, served at /__hm/heatmap-fake.js).
 * It defines window._fireCustomEvent(name, destination) the way the delivered scripts call it: each name counts once per
 * visit (localStorage key hCT_<name>, as INSTALL.md says), every call is logged to the console as "Heatmap>Klaviyo ...",
 * and fired names are kept in window.__hmEvents so a developer can read them. It sends nothing anywhere.
 */
export const HEATMAP_FAKE_JS = `(function () {
  var fired = (window.__hmEvents = window.__hmEvents || []);
  window._fireCustomEvent = function (name, destination) {
    if (typeof name !== "string" || !name) return false;
    var key = "hCT_" + name;
    var tag = "Heatmap>" + (destination === "klaviyo" ? "Klaviyo" : String(destination));
    try {
      if (localStorage.getItem(key)) {
        console.log(tag, "skipped (already fired this visit):", name);
        return false;
      }
      localStorage.setItem(key, "1");
    } catch (e) {
      /* storage blocked: fire anyway */
    }
    fired.push({ name: name, destination: destination, at: Date.now() });
    console.log(tag, "fired:", name);
    return true;
  };
})();
`;
