# Adding the Klaviyo script to a website

Klaviyo's onsite script (Klaviyo.js) lets Klaviyo recognise visitors who arrive from a Klaviyo email or form. Heatmap relies on it: our tracker reads the visitor's Klaviyo ID from the cookie this script sets, so Heatmap's events can be matched to the right Klaviyo profile. Without it, no Heatmap events reach Klaviyo for that site.

## 1. Find the account's Public API Key

1. Log in to Klaviyo and make sure you are in the right account (account name, bottom left).
2. Click the **account name** (bottom left) → **Settings** → **General** → **API keys**.
   On some older screens this is **Account** → **Settings** → **API keys**.
3. Copy the **Public API Key**, also called the **Site ID** or **Company ID**. It is **6 characters**, for example `AbC123`.

> **Warning:** Use only the **Public** key. Never put a **Private** API key (it starts with `pk_`) in a website or script: it gives full access to the Klaviyo account.

## 2. Build the script tag

Replace `PUBLIC_API_KEY` in **both** places with the 6-character key:

```html
<script async type="text/javascript"
  src="https://static.klaviyo.com/onsite/js/PUBLIC_API_KEY/klaviyo.js?company_id=PUBLIC_API_KEY"></script>
```

Example for an account whose key is `AbC123`:

```html
<script async type="text/javascript"
  src="https://static.klaviyo.com/onsite/js/AbC123/klaviyo.js?company_id=AbC123"></script>
```

## 3. Add it to the site

| Site type | What to do |
|---|---|
| **Custom site** | Paste the tag into the **main template**, so it loads on every page. Save and publish. |
| **WordPress** | Use the theme's header/footer scripts setting, or a "header and footer scripts" plugin. Save and publish. |
| **Shopify** | Don't paste it by hand. Turn on Klaviyo's **app embed**: **Online Store** → **Themes** → **Customize** → **App embeds** → **Klaviyo**. |
| **Other e-commerce integrations** (BigCommerce, WooCommerce, …) | The integration may already install it. Check first: two copies double-count activity. |

**Where on the page:** Klaviyo suggests placing it with your other analytics scripts, or just before the closing `</body>` tag. Inside `<head>` with `async` also works.

## 4. Check that it works

1. Open the site in Chrome and open **DevTools** (F12) → **Network**, then filter by `klaviyo`.
   `klaviyo.js?company_id=…` should load with status **200**.
2. Click a link in a **real Klaviyo email** (not a test or preview email). The landing page URL should contain **`_kx=`**.
3. In DevTools → **Application** → **Cookies**, the site should now have a **`__kla_id`** cookie. To read it, run this in the **Console**:

   ```js
   JSON.parse(atob(decodeURIComponent(document.cookie.match(/__kla_id=([^;]+)/)[1])))
   ```

   You should see `$exchange_id`, ending in `.` plus the account's Public API Key.
4. In Klaviyo, open your profile: **Active on Site** should appear within a few seconds.

## Troubleshooting

| Problem | Likely cause |
|---|---|
| `klaviyo.js` doesn't load, or shows as blocked | An ad or tracking blocker, or strict browser privacy settings (Brave, Safari, uBlock, Edge strict mode). Test with them off. |
| No `_kx=` in the URL | You clicked a test/preview or forwarded email, or opened a copy of the link. Use the real email sent to your profile. |
| No `__kla_id` cookie, or no `$exchange_id` in it | The link opened in an email app's built-in browser, or the page didn't finish loading. Open the link in a normal browser and wait for the page to load. |
| Events are counted twice | The script is installed twice, e.g. by hand and by an e-commerce integration. Remove one. |

## Sources

- [Getting started with Klaviyo onsite tracking](https://help.klaviyo.com/hc/en-us/articles/115005076767) (Klaviyo Help)
- [How to manually install Klaviyo.js for Shopify stores](https://help.klaviyo.com/hc/en-us/articles/360020342232) (Klaviyo Help)
- [Integrate a platform without a pre-built Klaviyo integration](https://developers.klaviyo.com/en/v1-2/docs/guide-to-integrating-a-platform-without-a-pre-built-klaviyo-integration) (Klaviyo Developers)
- [How to integrate with Spree](https://help.klaviyo.com/hc/en-us/articles/115005255448) (Klaviyo Help)
