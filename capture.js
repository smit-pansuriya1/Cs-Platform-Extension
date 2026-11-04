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
// Long messages: "Read more" is clicked first so the full text is captured.
// Anywhere else (or if WhatsApp's markup changes) → the plain selected text.
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

  const rootOf = (el) => el.closest('[data-id]') || el.parentElement || el
  const ids = hits.map((el) => rootOf(el).getAttribute('data-id'))

  // Expand truncated messages.
  let expanded = 0
  for (const el of hits) {
    const root = rootOf(el)
    for (const leaf of root.querySelectorAll('*')) {
      if (leaf.children.length === 0 && /^read more$/i.test((leaf.textContent || '').trim())) {
        ;(leaf.closest('[role="button"]') || leaf).click()
        expanded++
      }
    }
  }
  if (expanded) await new Promise((r) => setTimeout(r, 450))

  // Text of a node with line breaks and emoji (<img alt="😀">) kept.
  const textOf = (node) => {
    const c = node.cloneNode(true)
    c.querySelectorAll('img[alt]').forEach((img) => img.replaceWith(document.createTextNode(img.getAttribute('alt'))))
    c.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode('\n')))
    return (c.textContent || '').replace(/\u00a0/g, ' ').replace(/\s*Read more\s*$/i, '').trim()
  }

  const lines = []
  const seen = new Set()
  hits.forEach((orig, i) => {
    // Re-find after "Read more" re-rendered the bubble.
    const esc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'))
    const fresh = ids[i] && document.querySelector(`[data-id="${esc(ids[i])}"] [data-pre-plain-text]`)
    const el = fresh || orig
    const prefix = el.getAttribute('data-pre-plain-text') || ''
    const root = rootOf(el)

    const quoteEl = root.querySelector('.quoted-mention')
    const quoteBox = quoteEl ? quoteEl.closest('[role="button"]') || quoteEl : null
    const quote = quoteEl ? textOf(quoteEl).replace(/\s+/g, ' ') : ''

    const bodies = [...el.querySelectorAll('span.selectable-text')]
      .filter((s) => !(quoteBox && quoteBox.contains(s)))
      .filter((s, _, all) => !all.some((o) => o !== s && o.contains(s)))
    let body = bodies.map(textOf).filter(Boolean).join('\n')
    if (!body) {
      const c = el.cloneNode(true)
      c.querySelectorAll('.quoted-mention').forEach((q) => q.remove())
      body = textOf(c)
    }
    if (!body && !quote) body = '[media]'

    const key = `${prefix}|${body}`
    if (seen.has(key)) return
    seen.add(key)

    const q = quote ? `[replying to: "${quote.length > 220 ? `${quote.slice(0, 220)}…` : quote}"]\n` : ''
    lines.push(`${prefix}${q}${body}`.trim())
  })

  return { text: lines.join('\n'), structured: true, messages: lines.length, expanded }
}
