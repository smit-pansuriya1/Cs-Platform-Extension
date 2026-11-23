// WhatsApp Web selection capture — content script on https://web.whatsapp.com
// (manifest `content_scripts`; background.js also injects it into WhatsApp tabs
// that were open before the extension was installed/reloaded).
//
// Why a content script that runs all the time: WhatsApp Web only keeps the
// messages near the screen in the page. Select 30 messages by dragging and
// scrolling, and by the time you right-click (or Ctrl+C) the first ~15 have
// been removed from the page — so the selection, and WhatsApp's own copy,
// only contain what is still loaded. This script RECORDS every message the
// selection touches while you drag, so messages that scroll away are kept.
//
// Each message is rebuilt in WhatsApp's own copy format from the bubble's
// `data-pre-plain-text="[1:40 pm, 3/11/2026] Name: "` attribute:
//   [1:40 pm, 3/11/2026] Neha: Let me check.
//   [11:46 am, 4/11/2026] Neha: [replying to: "Please check meeting id…"]
//   @Rahul, Let me check.
//
// • Right-click → Add to CS Platform: background.js asks for the capture
//   ({ type: 'cs-capture' }); "Read more" is clicked in rounds on the messages
//   still on screen so long messages come in whole.
// • Ctrl+C / Copy across 2+ messages: the clipboard gets the same full list
//   (WhatsApp's own copy would only have the loaded part). Copying inside one
//   message (a meeting ID, a sentence) is left to WhatsApp.
// A new selection (left mouse down) starts a fresh recording.
(() => {
  if (window.__csWaCapture) return
  window.__csWaCapture = true

  const MSG = '[data-pre-plain-text]'
  const TEXT = '.selectable-text, [data-testid="selectable-text"]'
  const READ_MORE = /^(read more|show more)$/i

  const recs = new Map() // key → { key, prefix, body, quote, truncated }
  let order = []         // keys in chat order

  const rootOf = (el) => el.closest('[data-id]') || el.parentElement || el
  const keyOf = (el) => rootOf(el).getAttribute('data-id') || el.getAttribute('data-pre-plain-text') + (el.textContent || '').slice(0, 80)
  const esc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  function readMoreButtons(root) {
    const out = new Set()
    for (const node of root.querySelectorAll('[role="button"], button, .read-more-button, span, div')) {
      if (node.children.length > 1) continue
      if (!READ_MORE.test((node.textContent || '').trim())) continue
      const btn = node.closest('[role="button"], button') || (node.classList.contains('read-more-button') ? node : null)
      // A message whose text is literally "read more" is not the button.
      if (!btn && (node.closest(TEXT) || node.querySelector(TEXT))) continue
      out.add(btn || node)
    }
    return [...out]
  }

  // Text of a node with line breaks and emoji (<img alt="😀">) kept, buttons dropped.
  function textOf(node) {
    const c = node.cloneNode(true)
    c.querySelectorAll('img[alt]').forEach((img) => img.replaceWith(document.createTextNode(img.getAttribute('alt'))))
    c.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode('\n')))
    for (const b of readMoreButtons(c)) b.remove()
    return (c.textContent || '').replace(/\u00a0/g, ' ').trim()
  }

  function readMessage(el) {
    const root = rootOf(el)
    const quoteEl = root.querySelector('.quoted-mention')
    const quoteBox = quoteEl ? quoteEl.closest('[role="button"]') || quoteEl : null
    const quote = quoteEl ? textOf(quoteEl).replace(/\s+/g, ' ') : ''
    const spans = [...el.querySelectorAll('span.selectable-text, span[data-testid="selectable-text"]')]
      .filter((s) => !(quoteBox && quoteBox.contains(s)))
      .filter((s, _, all) => !all.some((o) => o !== s && o.contains(s)))
    let body = spans.map(textOf).filter(Boolean).join('\n')
    // Whole bubble when it holds more (markup changed / text outside the span).
    const c = el.cloneNode(true)
    c.querySelectorAll('.quoted-mention').forEach((q) => (q.closest('[role="button"]') || q).remove())
    const whole = textOf(c)
    if (whole.length > body.length + 20) body = whole
    if (!body && !quote) body = '[media]'
    return {
      key: keyOf(el),
      prefix: el.getAttribute('data-pre-plain-text') || '',
      body,
      quote,
      truncated: readMoreButtons(root).length > 0,
    }
  }

  function editableSelection(sel) {
    const n = sel && sel.anchorNode
    const el = n && (n.nodeType === 1 ? n : n.parentElement)
    return Boolean(el && el.closest('[contenteditable="true"], input, textarea'))
  }

  function selectedMessages(sel) {
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || editableSelection(sel)) return null
    const range = sel.getRangeAt(0)
    const all = [...document.querySelectorAll(MSG)]
    const hits = all.filter((el) => { try { return range.intersectsNode(el) } catch { return false } })
    return { all, hits }
  }

  // Merge what is selected right now into the recording, keeping chat order.
  function snapshot() {
    const cur = selectedMessages(window.getSelection())
    if (!cur) return
    const hitKeys = []
    for (const el of cur.hits) {
      const r = readMessage(el)
      const prev = recs.get(r.key)
      // Keep the longest text seen (a "Read more" may have been opened meanwhile).
      recs.set(r.key, prev && prev.body.length > r.body.length ? { ...r, body: prev.body, truncated: prev.truncated && r.truncated } : r)
      hitKeys.push(r.key)
    }
    // Insert new keys next to a neighbour already in the order.
    hitKeys.forEach((k, i) => {
      if (order.includes(k)) return
      for (let j = i - 1; j >= 0; j--) {
        const at = order.indexOf(hitKeys[j])
        if (at >= 0) { order.splice(at + 1, 0, k); return }
      }
      for (let j = i + 1; j < hitKeys.length; j++) {
        const at = order.indexOf(hitKeys[j])
        if (at >= 0) { order.splice(at, 0, k); return }
      }
      order.push(k)
    })
    // Messages still on screen but no longer selected (drag went back) → drop.
    const hitSet = new Set(hitKeys)
    for (const el of cur.all) {
      const k = keyOf(el)
      if (!hitSet.has(k) && recs.has(k)) { recs.delete(k); order = order.filter((x) => x !== k) }
    }
  }

  function reset() {
    recs.clear()
    order = []
  }

  let queued = false
  document.addEventListener('selectionchange', () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => { queued = false; snapshot() })
  })
  // Left button down = a new selection begins (right-click keeps it).
  document.addEventListener('mousedown', (e) => { if (e.button === 0 && !e.shiftKey) reset() }, true)

  function lines() {
    return order.filter((k) => recs.has(k)).map((k) => {
      const r = recs.get(k)
      const q = r.quote ? `[replying to: "${r.quote.length > 220 ? `${r.quote.slice(0, 220)}…` : r.quote}"]\n` : ''
      return `${r.prefix}${q}${r.body}`.trim()
    })
  }

  const mounted = (k) => document.querySelector(`[data-id="${esc(k)}"]`)

  // Click "Read more" (in rounds) on recorded messages that are still on screen.
  async function expandMounted() {
    let expanded = 0
    for (let round = 0; round < 12; round++) {
      let clicked = 0
      for (const k of order) {
        const root = mounted(k)
        if (!root) continue
        for (const b of readMoreButtons(root)) { b.click(); clicked++ }
      }
      if (!clicked) break
      expanded += clicked
      for (let t = 0; t < 6; t++) {
        await sleep(100)
        if (!order.some((k) => { const r = mounted(k); return r && readMoreButtons(r).length })) break
      }
    }
    // Re-read the expanded bubbles.
    for (const k of order) {
      const el = document.querySelector(`[data-id="${esc(k)}"] ${MSG}`)
      if (!el) continue
      const r = readMessage(el)
      const prev = recs.get(k)
      if (!prev || r.body.length >= prev.body.length) recs.set(k, r)
    }
    return expanded
  }

  async function capture() {
    const sel = window.getSelection()
    const plain = String(sel || '').trim()
    snapshot()
    if (!recs.size) return { text: plain, structured: false }
    const expanded = await expandMounted()
    const out = lines()
    const text = out.join('\n')
    // Long messages that scrolled away before "Read more" could be clicked.
    const cutOff = order.filter((k) => recs.get(k)?.truncated).length
    // Letters/digits only, so stamps and whitespace don't skew the comparison.
    const size = (s) => (s.match(/[\p{L}\p{N}]/gu) || []).length
    if (size(plain) > size(text) * 1.2 + 40) {
      return { text: plain, structured: false, partial: true, messages: out.length, expanded }
    }
    return { text, structured: true, messages: out.length, expanded, cutOff }
  }

  // Ctrl+C / Copy on a selection of messages → the full recorded list.
  window.addEventListener('copy', (e) => {
    const sel = window.getSelection()
    if (editableSelection(sel)) return
    snapshot()
    // One message (e.g. copying a meeting ID) → leave WhatsApp's normal copy alone.
    if (recs.size < 2 || !e.clipboardData) return
    e.clipboardData.setData('text/plain', lines().join('\n'))
    e.preventDefault()
    e.stopImmediatePropagation()
    // Long messages still on screen: expand, then put the whole text on the clipboard.
    if (order.some((k) => recs.get(k)?.truncated && mounted(k))) {
      expandMounted().then(() => navigator.clipboard.writeText(lines().join('\n'))).catch(() => {})
    }
  }, true)

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== 'cs-capture') return undefined
      capture().then(sendResponse, (err) => sendResponse({ error: String(err?.message || err) }))
      return true // async response
    })
  }

  // For tests (jsdom).
  window.__csWaCaptureApi = { snapshot, capture, reset, lines }
})()
