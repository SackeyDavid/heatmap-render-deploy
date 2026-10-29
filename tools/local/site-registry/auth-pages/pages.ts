import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const MARK_PATH =
  "M21.2126 14.6341V14.6958C21.2126 15.9589 20.9353 17.2529 20.3808 18.4236C18.902 21.5661 15.359 23.8768 11.7235 24C11.6311 24 11.5387 24 11.4462 24C10.4604 24 9.5053 23.846 8.58103 23.5687C4.36024 22.2747 2.63495 18.4236 2.63495 18.4236C2.38848 17.8999 2.20363 17.3453 2.1112 16.7908C1.49503 13.4634 3.62083 10.6906 4.05215 10.1669C4.5759 9.5199 5.13046 8.93453 5.77744 8.41078L6.94817 10.0436L5.9931 11.0295C5.71582 11.3376 3.99053 13.4942 4.54509 16.267C5.16126 19.5944 8.48861 21.0116 9.04316 21.1964C9.19721 21.258 9.32044 21.2888 9.32044 21.2888C10.0599 21.5045 10.8609 21.6277 11.6311 21.5969C14.3731 21.5045 17.0226 19.81 18.1317 17.4069C18.5323 16.5135 18.7479 15.5584 18.7479 14.5725C18.7787 13.8947 18.6555 13.1861 18.4398 12.5392C18.3166 12.2311 18.1934 11.923 18.0085 11.6457C17.2383 10.2901 13.0791 5.26829 11.9392 3.72786L10.6144 5.66881L14.1574 9.92041C14.4347 10.2593 14.6812 10.629 14.9276 10.9987C15.4514 11.8306 15.8827 12.4775 16.1292 13.3402C16.3756 14.1412 16.4064 14.973 16.2524 15.7741C15.8519 17.4685 14.0342 19.2555 11.7235 19.3171C11.0765 19.3479 10.4296 19.2246 9.81338 18.9782C9.19721 18.7317 8.67346 18.3928 8.21133 17.9307C7.84162 17.5918 6.45523 16.2978 6.64008 14.4185C6.79413 12.7856 7.96486 11.8306 8.24214 11.6149L9.5361 13.2478C9.13559 13.6483 8.88912 14.1412 8.85831 14.6958C8.79669 15.7741 9.62853 16.4519 9.81338 16.6059C10.1215 16.8524 10.4912 17.0064 10.8917 17.0988C11.2922 17.1913 11.6927 17.1913 12.0932 17.068C12.6478 16.914 13.1099 16.5751 13.4488 16.1746C13.7877 15.7433 14.0034 15.1887 14.0034 14.665C14.0034 14.2028 13.8801 13.7407 13.6337 13.3402L7.7492 5.73042L8.02648 5.36072C9.1664 3.82028 10.2755 2.24904 11.4154 0.708601L11.9392 0L12.5245 0.677792C12.8634 1.07831 13.2023 1.47882 13.5104 1.91014C15.2049 4.06675 18.5631 7.97946 20.0727 10.2901L20.1035 10.3209C20.7813 11.6457 21.1818 13.1245 21.2126 14.6341Z";

const ICON_SIGNIN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';

const ICON_GLOBE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

const ICON_CLOCK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

const ICON_ARROW =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

const ICON_LINK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

const ICON_PENCIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

const ICON_CHECK_CIRCLE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><polyline points="7.5 12.5 10.5 15.5 16.5 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ICON_SHIELD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.2 7.6 8 9 4.8-1.4 8-4.5 8-9V6l-8-3Z"/><polyline points="8.5 12 11 14.5 15.5 9.5"/></svg>';

let cachedStyles: string | undefined;

function embeddedStyles(): string {
  if (cachedStyles) return cachedStyles;
  const brand = readFileSync(join(here, "brand-vars.css"), "utf8");
  const layout = readFileSync(join(here, "local-auth.css"), "utf8");
  cachedStyles = `<style>${brand}\n${layout.replace(/^@import url\([^)]+\);\s*/m, "")}</style>`;
  return cachedStyles;
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${embeddedStyles()}
</head>
<body class="hm-local-auth">
<header class="hm-local-auth__header">
  <div class="hm-local-auth__header-inner">
    <span class="hm-local-auth__mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${MARK_PATH}"/></svg></span>
    <span class="hm-local-auth__wordmark">heatmap</span>
  </div>
</header>
<div class="hm-local-auth__page">
${body}
</div>
</body>
</html>`;
}

/** Branded stand-in page with one-time Continue link (single use). */
export function signInLinkPage(siteId: string, goUrl: string, email = "", saved = false, label = siteId): string {
  return shell(
    "Sign in",
    `<article class="hm-local-auth__card">
  <div class="hm-local-auth__card-head">
    <span class="hm-local-auth__hero-icon" aria-hidden="true">${ICON_SIGNIN}</span>
    <h1>Sign in</h1>
  </div>
  <form class="hm-local-auth__who" method="post" action="/signin/save" data-editing="false">
    <input type="hidden" name="from" value="${esc(siteId)}">
    <div class="hm-local-auth__site-row">
      <span class="hm-local-auth__row-icon" aria-hidden="true">${ICON_GLOBE}</span>
      <div class="hm-local-auth__who-fields">
        <p class="hm-local-auth__muted">Website</p>
        <p class="hm-local-auth__site"><span data-view data-site>${esc(label)}</span>
          <button type="button" class="hm-local-auth__pencil" data-edit aria-label="Edit website and email">${ICON_PENCIL}</button>
          <input class="hm-local-auth__input" data-field type="text" name="website" value="${esc(label)}" aria-label="Website" autocomplete="off" hidden>
        </p>
        <div data-field hidden>
          <p class="hm-local-auth__muted">Email</p>
          <input class="hm-local-auth__input" type="email" name="email" value="${esc(email)}" aria-label="Email" autocomplete="email">
        </div>
      </div>
      <span class="hm-local-auth__connected" data-view>${ICON_CHECK} Connected</span>
      <button type="submit" class="hm-local-auth__save" data-field hidden>${ICON_CHECK} Save</button>
    </div>
    <p class="hm-local-auth__saved" role="status" data-note${saved ? "" : " hidden"}>${saved ? "Saved. Your new sign-in link is ready." : ""}</p>
  </form>
  <script>
    (function () {
      var form = document.querySelector(".hm-local-auth__who");
      var edit = form.querySelector("[data-edit]");
      var views = form.querySelectorAll("[data-view]");
      var fields = form.querySelectorAll("[data-field]");
      var note = form.querySelector("[data-note]");
      function show(editing) {
        form.setAttribute("data-editing", editing ? "true" : "false");
        views.forEach(function (e) { e.hidden = editing; });
        edit.hidden = editing;
        fields.forEach(function (e) { e.hidden = !editing; });
      }
      function say(text, bad) { note.textContent = text; note.hidden = !text; note.style.color = bad ? "#b3261e" : ""; }
      edit.addEventListener("click", function () { say(""); show(true); form.querySelector("input[name=website]").focus(); });
      // Saving stays on this page: it sends the form in the background and shows the new values.
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        say("");
        fetch("/signin/save", { method: "POST", headers: { accept: "application/json" }, body: new URLSearchParams(new FormData(form)) })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (!res.ok) { say(res.d.error || "Could not save.", true); return; }
            form.querySelector("[data-site]").textContent = res.d.label;
            form.querySelector("input[name=from]").value = res.d.siteId;
            form.querySelector("input[name=website]").value = res.d.label;
            form.querySelector("input[name=email]").value = res.d.email;
            var go = document.querySelector("[data-go]");
            go.setAttribute("href", res.d.goUrl);
            document.querySelector("[data-go-text]").textContent = res.d.goUrl;
            history.replaceState(null, "", "/signin?site=" + encodeURIComponent(res.d.siteId));
            show(false);
            say("Saved. Your new sign-in link is ready.");
          })
          .catch(function () { say("Could not save. Please try again.", true); });
      });
    })();
  </script>
  <p>Your one-time sign-in link is ready.</p>
  <ul class="hm-local-auth__facts">
    <li>${ICON_CHECK_CIRCLE} Works always</li>
    <li>${ICON_CLOCK} Sets up in 2 seconds</li>
    <li>${ICON_SHIELD} Secured</li>
  </ul>
  <div class="hm-local-auth__cta-wrap">
    <a class="hm-local-auth__cta" data-go href="${esc(goUrl)}">Continue sign-in ${ICON_ARROW}</a>
  </div>
  <div class="hm-local-auth__link-block">
    <p class="hm-local-auth__muted">${ICON_LINK} Or open this address</p>
    <code class="hm-local-auth__code" data-go-text>${esc(goUrl)}</code>
  </div>
  <p class="hm-local-auth__foot">Served on your computer for testing only. Not Heatmap production login.</p>
</article>`,
  );
}

/** Branded plain message (404, 410, etc.) — no redirect. */
export function authMessagePage(title: string, message: string, error = false): string {
  const cardClass = error ? "hm-local-auth__card hm-local-auth__card--error" : "hm-local-auth__card";
  return shell(title, `<article class="${cardClass}"><div class="hm-local-auth__card-head"><h1>${esc(title)}</h1></div><p>${esc(message)}</p></article>`);
}
