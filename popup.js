// Form for one WhatsApp Inbox item → POST <server>/api/wa-inbox.
// Opened from the toolbar (empty, paste text) or the right-click menu (pre-filled).

const DEFAULT_SERVER = 'https://cs-platform.videosdk.live'
const $ = (id) => document.getElementById(id)
const fromMenu = new URLSearchParams(location.search).get('from') === 'menu'

let settings = { server: DEFAULT_SERVER, key: '', addedBy: '', lastGroup: '', recentGroups: [] }

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
  const s = await chrome.storage.local.get(['server', 'key', 'addedBy', 'lastGroup', 'recentGroups'])
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

// ── Groups (server list + recently used) ────────────────────────────────────
async function loadGroups() {
  const names = new Set(settings.recentGroups)
  try {
    const res = await fetch(`${serverBase()}/api/wa-inbox/groups`)
    if (res.ok) {
      const data = await res.json()
      for (const g of data.groups || []) names.add(g.name)
    }
  } catch {
    /* offline / wrong server — recent groups still work */
  }
  const list = $('groups')
  list.replaceChildren(...[...names].sort().map((n) => Object.assign(document.createElement('option'), { value: n })))
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
  const group = $('group').value.trim()
  const text = $('text').value.trim()
  if (!group || !text) return showMsg('Group and text are required', 'err')
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
    settings.lastGroup = group
    await chrome.storage.local.set({ lastGroup: group, recentGroups: recent })

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

async function init() {
  await loadSettings()
  $('group').value = settings.lastGroup || ''

  if (fromMenu) {
    const { draft } = await chrome.storage.session.get('draft')
    if (draft?.text) $('text').value = draft.text
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
  $('form').addEventListener('submit', submit)
  ;($('group').value ? $('title') : $('group')).focus()
}

init()
