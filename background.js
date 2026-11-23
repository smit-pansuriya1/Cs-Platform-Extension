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
// message and when — so read the selection from the page itself (allowed by
// activeTab, which the menu click grants). captureSelection (capture.js)
// rebuilds "[time, date] Name: text" lines on WhatsApp Web. Falls back to
// selectionText if the page can't be scripted.
importScripts('capture.js')

async function readSelection(tab, info) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      func: captureSelection,
    })
    const out = res?.result
    if (out?.text) return out
  } catch {
    /* chrome:// pages, PDF viewer, etc. */
  }
  return { text: info.selectionText || '', structured: false }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return
  const { text, structured, messages, expanded, partial } = await readSelection(tab, info)
  await chrome.storage.session.set({ draft: { text, structured, messages, expanded, partial, pageUrl: info.pageUrl || '', at: Date.now() } })
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html?from=menu'),
    type: 'popup',
    width: 460,
    height: 680,
  })
})
