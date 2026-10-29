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

// `info.selectionText` drops line breaks, so read the selection from the page
// itself (allowed by activeTab, which the menu click grants). Falls back to
// selectionText if the page can't be scripted.
async function readSelection(tab, info) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      func: () => String(window.getSelection?.() || ''),
    })
    const text = (res?.result || '').trim()
    if (text) return text
  } catch {
    /* chrome:// pages, PDF viewer, etc. */
  }
  return info.selectionText || ''
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return
  const text = await readSelection(tab, info)
  await chrome.storage.session.set({ draft: { text, pageUrl: info.pageUrl || '', at: Date.now() } })
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html?from=menu'),
    type: 'popup',
    width: 460,
    height: 680,
  })
})
