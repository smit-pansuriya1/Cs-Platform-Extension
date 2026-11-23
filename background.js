// Right-click "Add to CS Platform" on any text selection → opens the form
// (popup.html) pre-filled with the selected text.
const MENU_ID = 'cs-platform-add'

// removeAll first: onInstalled also fires on update/reload, and re-creating an
// existing id fails ("Cannot create item with duplicate id").
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Add to CS Platform',
    contexts: ['selection'],
  }))
})

// `info.selectionText` drops line breaks and, on WhatsApp Web, who sent each
// message and when — and WhatsApp unloads messages that scroll away, so a long
// selection is incomplete by the time of the right-click. capture.js (content
// script on web.whatsapp.com) records every selected message while you drag;
// ask it for the capture. Tabs opened before the extension was (re)loaded
// don't have it yet → inject it once, then ask. Other pages: plain selection.
const isWhatsApp = (url) => /^https:\/\/web\.whatsapp\.com\//.test(url || '')

async function askContentScript(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'cs-capture' })
}

async function readSelection(tab, info) {
  if (isWhatsApp(tab.url || info.pageUrl)) {
    try {
      let out
      try {
        out = await askContentScript(tab.id)
      } catch {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] })
        out = await askContentScript(tab.id)
      }
      if (out?.text) return out
    } catch {
      /* fall through to the plain selection */
    }
  }
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      func: () => String(window.getSelection() || '').trim(),
    })
    if (res?.result) return { text: res.result, structured: false }
  } catch {
    /* chrome:// pages, PDF viewer, etc. */
  }
  return { text: info.selectionText || '', structured: false }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return
  const { text, structured, messages, expanded, partial, cutOff } = await readSelection(tab, info)
  await chrome.storage.session.set({ draft: { text, structured, messages, expanded, partial, cutOff, pageUrl: info.pageUrl || '', at: Date.now() } })
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html?from=menu'),
    type: 'popup',
    width: 460,
    height: 680,
  })
})
