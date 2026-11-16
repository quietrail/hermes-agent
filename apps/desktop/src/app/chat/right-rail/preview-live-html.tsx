/**
 * Live HTML previews in browser-served Hermes.
 *
 * In a browser-served Webapp, an HTML file opened in the preview pane used to
 * arrive as a sanitized, script-free copy (`remoteHtmlPreviewDocument`), so an
 * interactive document such as a memo was dead there, while Electron's
 * `<webview>` runs the same file live. This frame runs it live in the SAME
 * isolation the inline `::preview` frame already uses for these files: an
 * opaque-origin `allow-scripts` sandbox behind the Webapp's preview shell (its
 * own CSP), no same-origin, no access to the app, its cookies or its storage.
 * The page gets a per-file `localStorage` through the preview storage bridge,
 * so answers survive a reload as they do in Desktop.
 */

import { useEffect, useMemo } from 'react'

import { PreviewDocumentFrame } from '@/components/ui/preview-document-frame'
import { injectAtHead, loadPreviewStore, persistStorageMessage, storageShimScript } from '@/lib/preview-storage-bridge'

export function decodeHtmlDataUrl(dataUrl: string | undefined): string | null {
  if (!dataUrl?.startsWith('data:')) {
    return null
  }

  const comma = dataUrl.indexOf(',')

  if (comma < 0) {
    return null
  }

  try {
    const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), char => char.charCodeAt(0))

    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export function LiveHtmlPaneFrame({
  dataUrl,
  path,
  reloadKey,
  title
}: {
  dataUrl: string | undefined
  path: string | null
  reloadKey?: number
  title: string
}) {
  const token = useMemo(() => Math.random().toString(36).slice(2), [])

  const doc = useMemo(() => {
    const html = decodeHtmlDataUrl(dataUrl)

    return html === null ? null : injectAtHead(html, storageShimScript(token, loadPreviewStore(path)))
    // reloadKey rebuilds from the latest saved store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUrl, path, token, reloadKey])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      persistStorageMessage(event.data, token, path)
    }

    window.addEventListener('message', onMessage)

    return () => window.removeEventListener('message', onMessage)
  }, [path, token])

  if (doc === null) {
    return null
  }

  return (
    <PreviewDocumentFrame
      className="absolute inset-0 size-full border-0 bg-white"
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      srcDoc={doc}
      title={title}
    />
  )
}
