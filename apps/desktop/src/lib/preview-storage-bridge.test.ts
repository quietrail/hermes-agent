// Persistence for opaque-origin HTML previews in browser-served Hermes.
import { afterEach, describe, expect, it } from 'vitest'

import {
  injectAtHead,
  loadPreviewStore,
  MAX_STORE_CHARS,
  MAX_TOTAL_CHARS,
  persistStorageMessage,
  previewStorageKey,
  STORAGE_MESSAGE_TYPE,
  storageShimScript
} from './preview-storage-bridge'

afterEach(() => window.localStorage.clear())

describe('persistStorageMessage', () => {
  const msg = (data: unknown, token = 'tok') => ({ data, token, type: STORAGE_MESSAGE_TYPE })

  it('saves the frame store under ITS file only', () => {
    expect(persistStorageMessage(msg({ 'memo-a': '{"a":1}' }), 'tok', '/m/a.html')).toBe(true)
    expect(loadPreviewStore('/m/a.html')).toEqual({ 'memo-a': '{"a":1}' })
    expect(loadPreviewStore('/m/b.html')).toEqual({})
  })

  it('ignores a wrong token, a wrong type, or a non-string map', () => {
    expect(persistStorageMessage(msg({ k: 'v' }, 'other'), 'tok', '/m/a.html')).toBe(false)
    expect(persistStorageMessage({ ...msg({ k: 'v' }), type: 'x' }, 'tok', '/m/a.html')).toBe(false)
    expect(persistStorageMessage(msg({ k: 1 }), 'tok', '/m/a.html')).toBe(false)
    expect(persistStorageMessage(msg(['v']), 'tok', '/m/a.html')).toBe(false)
    expect(window.localStorage.getItem(previewStorageKey('/m/a.html'))).toBeNull()
  })

  it('refuses a store over the size ceiling and keeps the last good one', () => {
    persistStorageMessage(msg({ k: 'ok' }), 'tok', '/m/a.html')
    expect(persistStorageMessage(msg({ k: 'x'.repeat(MAX_STORE_CHARS) }), 'tok', '/m/a.html')).toBe(false)
    expect(loadPreviewStore('/m/a.html')).toEqual({ k: 'ok' })
  })

  it('refuses a write that would push all preview stores past the shared ceiling', () => {
    const big = 'x'.repeat(MAX_STORE_CHARS - 100)
    expect(persistStorageMessage(msg({ k: big }), 'tok', '/m/1.html')).toBe(true)
    expect(persistStorageMessage(msg({ k: big }), 'tok', '/m/2.html')).toBe(MAX_TOTAL_CHARS >= 2 * MAX_STORE_CHARS)
    expect(persistStorageMessage(msg({ k: big }), 'tok', '/m/3.html')).toBe(false)
    // Rewriting an existing file does not count its own old copy.
    expect(persistStorageMessage(msg({ k: big }), 'tok', '/m/1.html')).toBe(true)
  })

  it('drops the key when the page clears its store', () => {
    persistStorageMessage(msg({ k: 'v' }), 'tok', '/m/a.html')
    persistStorageMessage(msg({}), 'tok', '/m/a.html')
    expect(window.localStorage.getItem(previewStorageKey('/m/a.html'))).toBeNull()
  })
})

describe('storageShimScript', () => {
  it('escapes the snapshot so a stored value cannot close the script', () => {
    const script = storageShimScript('tok', { k: '</script><script>alert(1)</script>' })

    expect(script.match(/<\/script>/g)).toHaveLength(1)
  })
})

describe('injectAtHead', () => {
  it('lands after <head>, after the doctype, or in front of a fragment', () => {
    expect(injectAtHead('<!doctype html><html><head><title>t</title>', 'X')).toBe('<!doctype html><html><head>X<title>t</title>')
    expect(injectAtHead('<!DOCTYPE html><p>x', 'X')).toBe('<!DOCTYPE html>X<p>x')
    expect(injectAtHead('<header>x</header>', 'X')).toBe('X<header>x</header>')
  })

  it('ignores <head> and <html> written inside the page body or its scripts', () => {
    const memo = '<meta charset="utf-8"><title>m</title><script>var p="<!doctype html><html><head></head>"</script>'

    expect(injectAtHead(memo, 'X')).toBe('X' + memo)
    expect(injectAtHead('<!-- c -->\n<html lang="en">\n<head>\n<title>', 'X')).toBe('<!-- c -->\n<html lang="en">\n<head>X\n<title>')
  })
})
