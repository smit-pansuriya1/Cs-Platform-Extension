// Form for one WhatsApp Inbox item → POST <server>/api/wa-inbox.
// Opened from the toolbar (empty, paste text) or the right-click menu (pre-filled).

const DEFAULT_SERVER = 'https://cs-platform.videosdk.live'
const $ = (id) => document.getElementById(id)
const fromMenu = new URLSearchParams(location.search).get('from') === 'menu'

let settings = { server: DEFAULT_SERVER, key: '', addedBy: '', recentGroups: [] }

// ── IST time helpers ────────────────────────────────────────────────────────
// Kept in sync with parseWaTimestamp in src/utils/waInbox.js (the server
// re-parses the text anyway when no time is sent).
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000

function istDate(y, mo, d, h, mi) {
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MS)
}

function parseWaTimestamp(text) {
  const m = String(text || '').match(
    /\[(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]/i,
  )
  if (!m) return null
  let [, h, mi, ampm, a, b, y] = m
  h = Number(h); mi = Number(mi); a = Number(a); b = Number(b); y = Number(y)
  if (y < 100) y += 2000
  if (ampm) {
    const pm = ampm.toLowerCase() === 'p'
    if (h === 12) h = pm ? 12 : 0
    else if (pm) h += 12
  }
  let day = a, month = b
  if (b > 12 && a <= 12) { day = b; month = a }
  if (month < 1 || month > 12 || day < 1 || day > 31 || h > 23 || mi > 59) return null
  return istDate(y, month, day, h, mi)
}

// Date → "YYYY-MM-DDTHH:MM" in IST, for <input type="datetime-local">.
function toIstLocal(date) {
  const d = new Date(date.getTime() + IST_OFFSET_MS)
  return d.toISOString().slice(0, 16)
}

// "YYYY-MM-DDTHH:MM" typed as IST → ISO with offset, so the laptop's own
// timezone never matters.
function istLocalToIso(value) {
  return value ? `${value}:00+05:30` : ''
}

// ── Settings ────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await chrome.storage.local.get(['server', 'key', 'addedBy', 'recentGroups'])
  settings = { ...settings, ...s, recentGroups: Array.isArray(s.recentGroups) ? s.recentGroups : [] }
  $('server').value = settings.server || DEFAULT_SERVER
  $('key').value = settings.key || ''
  $('addedBy').value = settings.addedBy || ''
  if (!settings.key || !settings.addedBy) $('settings').hidden = false
}

function serverBase() {
  return String(settings.server || DEFAULT_SERVER).trim().replace(/\/+$/, '')
}

async function saveSettings() {
  const server = $('server').value.trim().replace(/\/+$/, '') || DEFAULT_SERVER
  let origin
  try {
    origin = new URL(server).origin
  } catch {
    $('settingsMsg').textContent = 'Server must be a full URL (https://…)'
    return
  }
  // Servers other than the two built-in ones need a one-time permission grant.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false)
  if (!granted) {
    $('settingsMsg').textContent = 'Permission for that server was not granted'
    return
  }
  settings.server = server
  settings.key = $('key').value.trim()
  settings.addedBy = $('addedBy').value.trim()
  await chrome.storage.local.set({ server: settings.server, key: settings.key, addedBy: settings.addedBy })
  $('settingsMsg').textContent = 'Saved'
  loadGroups()
}

// ── Company picker (server list + recently used) ────────────────────────────
// Nothing is pre-selected. Type to search; pick a match, or "+ Add new
// company" creates it on the server (POST /api/wa-inbox/groups).
let companies = []   // names
let picked = null    // the chosen company name, or null
let activeIdx = -1
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase()

async function loadGroups() {
  const names = new Map(settings.recentGroups.map((n) => [norm(n), n]))
  try {
    const res = await fetch(`${serverBase()}/api/wa-inbox/groups`)
    if (res.ok) {
      const data = await res.json()
      for (const g of data.groups || []) names.set(norm(g.name), g.name)
    }
  } catch {
    $('groupHint').textContent = 'Could not load the company list — check Settings → Server'
  }
  companies = [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  if (document.activeElement === $('group')) renderList()
}

function listItems() {
  const q = norm($('group').value)
  if (!q) {
    const recent = settings.recentGroups.filter((n) => companies.some((c) => norm(c) === norm(n)))
    const rest = companies.filter((c) => !recent.some((r) => norm(r) === norm(c)))
    return [...recent.map((name) => ({ name, recent: true })), ...rest.map((name) => ({ name }))]
  }
  const items = companies.filter((c) => norm(c).includes(q)).map((name) => ({ name }))
  if (!companies.some((c) => norm(c) === q)) items.push({ add: $('group').value.trim().replace(/\s+/g, ' ') })
  return items
}

function renderList() {
  const ul = $('groupList')
  const items = listItems()
  if (activeIdx >= items.length) activeIdx = items.length - 1
  if (!items.length) {
    ul.replaceChildren(Object.assign(document.createElement('li'), { className: 'muted', textContent: 'No companies yet — type a name to add one' }))
  } else {
    ul.replaceChildren(...items.map((it, i) => {
      const li = document.createElement('li')
      li.setAttribute('role', 'option')
      if (i === activeIdx) li.className = 'active'
      if (it.add) {
        li.classList.add('add')
        li.textContent = `+ Add new company "${it.add}"`
      } else {
        li.textContent = it.name
        if (it.recent) li.append(Object.assign(document.createElement('small'), { className: 'hint', textContent: 'recent' }))
      }
      // mousedown, not click: fires before the input's blur closes the list
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(it) })
      return li
    }))
  }
  ul.hidden = false
  $('group').setAttribute('aria-expanded', 'true')
  ul.querySelector('li.active')?.scrollIntoView({ block: 'nearest' })
}

function closeList() {
  $('groupList').hidden = true
  $('group').setAttribute('aria-expanded', 'false')
  activeIdx = -1
}

function setPicked(name) {
  picked = name
  $('group').value = name || $('group').value
  $('group').classList.toggle('picked', Boolean(name))
  const hint = $('groupHint')
  hint.className = name ? 'hint ok' : 'hint'
  hint.textContent = name ? `✓ ${name}` : 'Pick from the list, or type a new name and add it'
}

async function choose(it) {
  closeList()
  if (!it.add) return setPicked(it.name)
  const name = it.add
  $('groupHint').className = 'hint'
  $('groupHint').textContent = `Adding ${name}…`
  try {
    const res = await fetch(`${serverBase()}/api/wa-inbox/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(settings.key ? { 'x-cs-key': settings.key } : {}) },
      body: JSON.stringify({ name }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    const saved = data.group?.name || name
    if (!companies.some((c) => norm(c) === norm(saved))) companies.push(saved)
    setPicked(saved)
    $('groupHint').textContent = data.created ? `✓ ${saved} added to the company list` : `✓ ${saved} (already in the list)`
  } catch (err) {
    $('groupHint').className = 'hint err'
    $('groupHint').textContent = `Could not add company: ${err.message}`
  }
}

function onGroupKey(e) {
  const open = !$('groupList').hidden
  const n = listItems().length
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    activeIdx = n ? (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + n) % n : -1
    renderList()
  } else if (e.key === 'Enter' && open) {
    e.preventDefault() // never submit the form from the search box
    const items = listItems()
    const q = norm($('group').value)
    const it = items[activeIdx] || items.find((x) => x.name && norm(x.name) === q) || (items.length === 1 ? items[0] : null)
    if (it) choose(it)
  } else if (e.key === 'Escape') {
    closeList()
  }
}

// ── Form ────────────────────────────────────────────────────────────────────
function setTimeFromText() {
  const parsed = parseWaTimestamp($('text').value)
  if (parsed) {
    $('waTime').value = toIstLocal(parsed)
    $('timeHint').textContent = 'Taken from the first [time, date] in the text'
  } else if (!$('waTime').value) {
    $('waTime').value = toIstLocal(new Date())
    $('timeHint').textContent = 'No WhatsApp timestamp in the text — set to now'
  }
}

function showMsg(text, kind) {
  const el = $('msg')
  el.textContent = text
  el.className = `msg ${kind || ''}`
}

async function submit(e) {
  e.preventDefault()
  // Typed an existing name exactly without clicking it → take it.
  if (!picked) {
    const exact = companies.find((c) => norm(c) === norm($('group').value))
    if (exact) setPicked(exact)
  }
  const group = picked
  const text = $('text').value.trim()
  if (!group) return showMsg('Pick a company from the list (or add it as new)', 'err')
  if (!text) return showMsg('Text is required', 'err')
  if (!/[\p{L}\p{N}]/u.test(text)) return showMsg('Text has no letters or numbers', 'err')
  if (text.length > 20000) return showMsg('Text is longer than 20000 characters — add it in smaller parts', 'err')
  if ($('waTime').value && new Date(istLocalToIso($('waTime').value)).getTime() > Date.now() + 15 * 60_000) {
    return showMsg('WhatsApp time is in the future — check the date', 'err')
  }
  if (!settings.key) showMsg('No inbox key saved — this only works if the server has no WA_INBOX_KEY')

  $('submit').disabled = true
  try {
    const res = await fetch(`${serverBase()}/api/wa-inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(settings.key ? { 'x-cs-key': settings.key } : {}) },
      body: JSON.stringify({
        group,
        title: $('title').value.trim(),
        text,
        waTime: istLocalToIso($('waTime').value),
        addedBy: settings.addedBy,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

    const recent = [group, ...settings.recentGroups.filter((g) => g !== group)].slice(0, 15)
    settings.recentGroups = recent
    await chrome.storage.local.set({ recentGroups: recent })

    const hidden = (data.redactions || []).map((r) => `${r.count} ${r.type}`).join(', ')
    const base = data.duplicate ? `Already in the inbox (${data.status || 'pending'}) — not added twice` : 'Added ✓'
    showMsg(hidden ? `${base} · hidden for safety: ${hidden}` : base, 'ok')
    $('text').value = ''
    $('title').value = ''
    if (fromMenu) setTimeout(() => window.close(), hidden ? 3500 : 1200)
  } catch (err) {
    showMsg(`Not added: ${err.message}`, 'err')
  } finally {
    $('submit').disabled = false
  }
}

// Live length so a long paste is visibly complete (and under the 20000 limit).
function showCount() {
  const n = $('text').value.length
  const el = $('count')
  el.textContent = n ? `${n.toLocaleString()} / 20,000 chars` : ''
  el.className = n > 20000 ? 'hint err' : 'hint'
}

async function init() {
  await loadSettings()
  // No company pre-selected — pick it every time.

  if (fromMenu) {
    const { draft } = await chrome.storage.session.get('draft')
    if (draft?.text) $('text').value = draft.text
    if (draft?.structured) {
      const more = draft.expanded ? ` · ${draft.expanded} “Read more” expanded` : ''
      $('textHint').textContent = `· ${draft.messages} message${draft.messages === 1 ? '' : 's'} with sender + time${more}`
    } else if (draft?.partial) {
      $('textHint').textContent = '· plain text — part of the selection was scrolled out of WhatsApp; check it is complete'
    } else if (/web\.whatsapp\.com/.test(draft?.pageUrl || '')) {
      $('textHint').textContent = '· plain text (sender/time not found — check before adding)'
    }
    await chrome.storage.session.remove('draft')
  }
  setTimeFromText()
  loadGroups()

  $('toggleSettings').addEventListener('click', () => { $('settings').hidden = !$('settings').hidden })
  $('saveSettings').addEventListener('click', saveSettings)
  $('now').addEventListener('click', () => {
    $('waTime').value = toIstLocal(new Date())
    $('timeHint').textContent = ''
  })
  $('text').addEventListener('change', setTimeFromText)
  $('text').addEventListener('input', showCount)
  showCount()
  $('form').addEventListener('submit', submit)
  $('group').addEventListener('focus', () => renderList())
  $('group').addEventListener('input', () => { setPicked(null); activeIdx = -1; renderList() })
  $('group').addEventListener('keydown', onGroupKey)
  $('group').addEventListener('blur', () => setTimeout(closeList, 120))
  $('group').focus()
}

init()
