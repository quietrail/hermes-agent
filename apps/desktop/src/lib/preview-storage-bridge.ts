/**
 * Persistence for opaque-origin HTML previews in browser-served Hermes.
 *
 * HTML previews run in an opaque-origin sandbox (`allow-scripts`, no
 * `allow-same-origin`), so `window.localStorage` throws inside them and an
 * interactive document (a memo, a checklist) cannot keep its own state. In
 * Electron the preview pane's `<webview>` has a persistent partition, so it
 * can; in a browser-served Webapp nothing could.
 *
 * This bridge gives each previewed FILE its own small key/value store, kept in
 * the app's own localStorage under a key derived from the file path, and hands
 * the document a synchronous `localStorage` look-alike:
 *
 * - reads come from a snapshot embedded in the srcdoc when it is built;
 * - writes are posted up (token-tagged, coalesced per tick) and persisted here.
 *
 * The frame can only ever read and write the store of the file it was built
 * from: the parent picks the key from its own state, never from the message.
 */

export const STORAGE_MESSAGE_TYPE = 'hermes-inline-preview-storage'
const STORAGE_PREFIX = 'hermes:preview-storage:v1:'
/** Per-file ceiling (characters of JSON). A memo's answers are a few KB. */
export const MAX_STORE_CHARS = 1_000_000
/** Ceiling for ALL preview stores together, so previews can never crowd out
 *  the app's own localStorage (drafts, layout, settings; about 5 MB in all). */
export const MAX_TOTAL_CHARS = 2_000_000

function otherStoresChars(exceptKey: string): number {
  let total = 0

  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index)

    if (key && key !== exceptKey && key.startsWith(STORAGE_PREFIX)) {
      total += key.length + (window.localStorage.getItem(key)?.length ?? 0)
    }
  }

  return total
}

export function previewStorageKey(path: string): string {
  return STORAGE_PREFIX + path
}

export function loadPreviewStore(path: string | null): Record<string, string> {
  if (!path) {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(previewStorageKey(path))
    const parsed = raw ? JSON.parse(raw) : null

    return sanitizeStore(parsed) ?? {}
  } catch {
    return {}
  }
}

/** Accept only a flat string→string map within the size ceiling. */
export function sanitizeStore(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const out: Record<string, string> = {}

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item !== 'string') {
      return null
    }

    out[key] = item
  }

  return out
}

/** Persist a store message from the frame. True when it was ours and saved. */
export function persistStorageMessage(data: unknown, token: string, path: string | null): boolean {
  if (!path || typeof data !== 'object' || data === null) {
    return false
  }

  const message = data as { data?: unknown; token?: unknown; type?: unknown }

  if (message.type !== STORAGE_MESSAGE_TYPE || message.token !== token) {
    return false
  }

  const store = sanitizeStore(message.data)

  if (!store) {
    return false
  }

  const json = JSON.stringify(store)

  if (json.length > MAX_STORE_CHARS) {
    return false
  }

  try {
    if (otherStoresChars(previewStorageKey(path)) + json.length > MAX_TOTAL_CHARS) {
      return false
    }

    if (Object.keys(store).length === 0) {
      window.localStorage.removeItem(previewStorageKey(path))
    } else {
      window.localStorage.setItem(previewStorageKey(path), json)
    }

    return true
  } catch {
    return false
  }
}

/** JSON safe to embed inside an inline <script>. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/**
 * The script that installs the store as `window.localStorage` (and
 * `sessionStorage`, kept in memory only) before the page's own scripts run.
 */
export function storageShimScript(token: string, snapshot: Record<string, string>): string {
  return (
    '<script>(function(){var t=' +
    scriptJson(token) +
    ',d=' +
    scriptJson(snapshot) +
    ',q=false,o=Object.prototype.hasOwnProperty;' +
    'function flush(){q=false;try{parent.postMessage({type:' +
    scriptJson(STORAGE_MESSAGE_TYPE) +
    ',token:t,data:d},"*")}catch(e){}}' +
    'function save(){if(!q){q=true;Promise.resolve().then(flush)}}' +
    'function mk(m,p){return{getItem:function(k){k=String(k);return o.call(m,k)?m[k]:null},' +
    'setItem:function(k,v){m[String(k)]=String(v);if(p)save()},removeItem:function(k){delete m[String(k)];if(p)save()},' +
    'clear:function(){for(var k in m)delete m[k];if(p)save()},key:function(i){var k=Object.keys(m);return i<k.length?k[i]:null},' +
    'get length(){return Object.keys(m).length}}}' +
    'var ls=mk(d,true),ss=mk({},false);' +
    'try{Object.defineProperty(window,"localStorage",{configurable:true,get:function(){return ls}})}catch(e){}' +
    'try{Object.defineProperty(window,"sessionStorage",{configurable:true,get:function(){return ss}})}catch(e){}' +
    'window.hermesPreviewStorage={persistent:true,flush:flush};addEventListener("pagehide",flush)})()</script>'
  )
}

/**
 * Put `head` right after the document's `<head>` (or `<html>`, or doctype),
 * so injected styles and scripts run before the page's own but never ahead
 * of `<!doctype>` (content before the doctype drops the page into quirks mode).
 */
export function injectAtHead(doc: string, head: string): string {
  // Only the document's LEADING tags count: a `<head>` written inside one of
  // the page's own scripts (a memo builds its print view from strings) must
  // never be mistaken for the real one.
  const lead = /^(?:\s|<!--[\s\S]*?-->)*(?:<!doctype[^>]*>)?(?:\s|<!--[\s\S]*?-->)*(?:<html\b[^>]*>)?(?:\s|<!--[\s\S]*?-->)*(?:<head\b[^>]*>)?/i.exec(doc)
  const at = lead ? lead[0].length : 0

  return doc.slice(0, at) + head + doc.slice(at)
}
