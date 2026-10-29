/**
 * The three browser snippets printed by `npm run live:preview`, and the one-line clear command. Plain strings: they are
 * pasted into DevTools (or run by an automated browser) on the real page. None of them reads or returns a cookie value,
 * a profile id, or the query string of any address.
 */

/** Sends the rendered page (a DOM export, not the server HTML) to the loopback receiver. Returns a short status string. */
export function captureSnippet(receiverUrl: string): string {
  return `(async()=>{try{var r=await fetch(${JSON.stringify(receiverUrl + "/capture")},{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:location.href,html:document.documentElement.outerHTML})});return "capture "+r.status+" "+(await r.text())}catch(e){return "capture failed: "+String(e)}})()`;
}

/**
 * Loads the published script into this page session only. Also records which event names the builder script logged
 * (its console line carries its version), so the read-out can tell its calls apart from the page's own v2 script.
 */
export function injectSnippet(scriptUrl: string, version: string): string {
  return `(function(){var V=${JSON.stringify(version)};if(window.__hmPreviewInjected)return "already injected";window.__hmPreviewInjected=V;window.__hmPreviewLog=[];var o=console.log;console.log=function(){try{var a=[].slice.call(arguments);if(a[0]==="[Heatmap>Klaviyo]"&&a.indexOf(V)>0)window.__hmPreviewLog.push(String(a[1]))}catch(e){}return o.apply(console,arguments)};var s=document.createElement("script");s.src=${JSON.stringify(scriptUrl)};s.onerror=function(){console.warn("live preview: script failed to load (check the console for a blocked request)")};document.head.appendChild(s);return "injected "+V})()`;
}

/**
 * After the visitor clicks and scrolls: returns a JSON string with event NAMES only (hCT_ markers, Klaviyo-bridge event
 * names with the numeric id removed), request COUNTS, and booleans. No cookie value, id or query string.
 */
export function readoutSnippet(): string {
  return `(function(){var H=[],B=[],t=0,q=0;try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k.indexOf("hCT_")===0)H.push(k.slice(4));var m=/^_heatmapKlaviyoBridge_.*?_klaviyo_(.*)$/.exec(k);if(m)B.push(m[1])}}catch(e){}try{performance.getEntriesByType("resource").forEach(function(e){try{var u=new URL(e.name);if(u.hostname==="conversions.heatmapcore.com"&&u.searchParams.get("request")==="tags")t++;if(u.hostname==="sstags.heatmapcore.com"&&u.searchParams.get("request")==="klaviyo_identity")q++}catch(x){}})}catch(e){}var d=document.documentElement,s=d.scrollHeight-window.innerHeight;return JSON.stringify({hCT:H,bridge:B,tagsCalls:t,identityCalls:q,fireCustomEvent:typeof window._fireCustomEvent==="function",klaId:/(?:^|;\\s*)__kla_id=/.test(document.cookie),scrollPercent:s>0?Math.round(window.scrollY/s*1000)/10:0,builderLogged:(window.__hmPreviewLog||[]).slice()})})()`;
}

/** Removes only localStorage keys starting hCT_ (Heatmap's once-per-visit markers). */
export const CLEAR_MARKERS_SNIPPET = `Object.keys(localStorage).filter(k=>k.startsWith('hCT_')).forEach(k=>localStorage.removeItem(k))`;
