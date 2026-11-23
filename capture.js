// Reads the user's selection from the page. Runs inside the tab (injected by
// background.js via chrome.scripting) — must stay self-contained: no imports,
// no outside variables.
//
// On WhatsApp Web, plain selected text loses who said what and when, and adds
// noise ("Today", bare "6:17 pm", "Read more"). Every message bubble carries
// `data-pre-plain-text="[1:40 pm, 3/11/2026] Smit Pansuriya: "`, so for each
// message the selection touches we rebuild WhatsApp's own copy format:
//
//   [1:40 pm, 3/11/2026] Smit Pansuriya: Let me check.
//   [11:46 am, 4/11/2026] Smit Pansuriya: [replying to: "Please check meeting id…"]
//   @Salim, Let me check.
//
// Long messages: WhatsApp only renders the start of a long message until
// "Read more" is clicked — and very long ones need SEVERAL clicks (each reveals
// the next chunk). Copying by hand has the same problem. So every selected
// message is expanded in rounds until no "Read more" is left (max ~5 s).
// Whole messages are taken even when the selection starts/ends mid-message.
// If WhatsApp unloaded part of the selection (very long scroll), the plain
// selection is used when it clearly holds more text. Anywhere else → plain text.
async function captureSelection() {
  const sel = window.getSelection ? window.getSelection() : null
  const plain = String(sel || '').trim()
  if (!sel || sel.rangeCount === 0 || !/(^|\.)web\.whatsapp\.com$/.test(location.hostname)) {
    return { text: plain, structured: false }
  }

  const range = sel.getRangeAt(0)
  const hits = [...document.querySelectorAll('[data-pre-plain-text]')].filter((el) => {
    try { return range.intersectsNode(el) } catch { return false }
  })
  if (!hits.length) return { text: plain, structured: false }

  const esc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'))
  const rootOf = (el) => el.closest('[data-id]') || el.parentElement || el
  const ids = hits.map((el) => rootOf(el).getAttribute('data-id'))
  const rootById = (id, fallback) => (id && document.querySelector(`[data-id="${esc(id)}"]`)) || fallback
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  const READ_MORE = /^(read more|show more)$/i
  const readMoreButtons = (root) => {
    const out = new Set()
    for (const node of root.querySelectorAll('[role="button"], .read-more-button, span, div')) {
      if (node.children.length > 1) continue
      if (!READ_MORE.test((node.textContent || '').trim())) continue
      const btn = node.closest('[role="button"], button') || (node.classList.contains('read-more-button') ? node : null)
      // A message whose text is literally "read more" is not the button.
      const TEXT = '.selectable-text, [data-testid="selectable-text"]'
      if (!btn && (node.closest(TEXT) || node.querySelector(TEXT))) continue
      out.add(btn || node)
    }
    return [...out]
  }

  // Expand in rounds: click every "Read more", wait for WhatsApp to re-render,
  // look again. Stops when none are left.
  let expanded = 0
  for (let round = 0; round < 12; round++) {
    let clicked = 0
    hits.forEach((orig, i) => {
      for (const b of readMoreButtons(rootById(ids[i], rootOf(orig)))) {
        b.click()
        clicked++
      }
    })
    if (!clicked) break
    expanded += clicked
    // Wait until the buttons are gone (or ~600 ms).
    for (let t = 0; t < 6; t++) {
      await sleep(100)
      const still = hits.some((orig, i) => readMoreButtons(rootById(ids[i], rootOf(orig))).length)
      if (!still) break
    }
  }

  // Text of a node with line breaks and emoji (<img alt="😀">) kept.
  const textOf = (node) => {
    const c = node.cloneNode(true)
    c.querySelectorAll('img[alt]').forEach((img) => img.replaceWith(document.createTextNode(img.getAttribute('alt'))))
    c.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode('\n')))
    for (const b of readMoreButtons(c)) b.remove()
    return (c.textContent || '').replace(/\u00a0/g, ' ').trim()
  }

  const lines = []
  const seen = new Set()
  hits.forEach((orig, i) => {
    // Re-find after "Read more" re-rendered the bubble.
    const fresh = ids[i] && document.querySelector(`[data-id="${esc(ids[i])}"] [data-pre-plain-text]`)
    const el = fresh || orig
    const prefix = el.getAttribute('data-pre-plain-text') || ''
    const root = rootOf(el)

    const quoteEl = root.querySelector('.quoted-mention')
    const quoteBox = quoteEl ? quoteEl.closest('[role="button"]') || quoteEl : null
    const quote = quoteEl ? textOf(quoteEl).replace(/\s+/g, ' ') : ''

    const bodies = [...el.querySelectorAll('span.selectable-text, span[data-testid="selectable-text"]')]
      .filter((s) => !(quoteBox && quoteBox.contains(s)))
      .filter((s, _, all) => !all.some((o) => o !== s && o.contains(s)))
    let body = bodies.map(textOf).filter(Boolean).join('\n')
    // Whole bubble text when it is longer (markup changed / text outside the span).
    const c = el.cloneNode(true)
    c.querySelectorAll('.quoted-mention').forEach((q) => (q.closest('[role="button"]') || q).remove())
    const whole = textOf(c)
    if (whole.length > body.length + 20) body = whole
    if (!body && !quote) body = '[media]'

    const key = `${prefix}|${body}`
    if (seen.has(key)) return
    seen.add(key)

    const q = quote ? `[replying to: "${quote.length > 220 ? `${quote.slice(0, 220)}…` : quote}"]\n` : ''
    lines.push(`${prefix}${q}${body}`.trim())
  })

  const text = lines.join('\n')
  // Letters/digits only, so stamps and whitespace don't skew the comparison.
  const size = (s) => (s.match(/[\p{L}\p{N}]/gu) || []).length
  if (size(plain) > size(text) * 1.2 + 40) {
    return { text: plain, structured: false, partial: true, messages: lines.length, expanded }
  }
  return { text, structured: true, messages: lines.length, expanded }
}
