# Seat Cover Solutions notes

Events go to Klaviyo through Heatmap only: `window._fireCustomEvent(name, "klaviyo")`. Event names only; no properties are sent.
Selectors come from the delivered script: vehicle selector widgets (`.vehicle-menu-container`, `.select-your-vehicle`, `.scs-cle-ymm`), `#vehicle-submit-button`, `.td-card[aria-label^='Play video review']`, `.td-tab-btn` (Photo Reviews).
Not verified on the live site; see `RELEASE-NOTES.md` and `INSTALL.md`.
