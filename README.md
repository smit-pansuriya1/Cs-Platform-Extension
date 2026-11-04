# CS Platform — WhatsApp Inbox extension

Select text on WhatsApp Web (or any page) → right-click → **Add to CS Platform**.
The text lands in the CS Platform **WhatsApp Inbox** (`/whatsapp-inbox`), where
it's compressed (optional, Gemini) and added to a Plain thread as an internal note.

## Install (unpacked, no Web Store needed)

1. Chrome → `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → pick this `chrome-extension/` folder.
3. Click the extension icon → **Settings**:
   - **Server** — `https://cs-platform.videosdk.live` (default) or `http://localhost:3000`.
     Any other server asks for a one-time permission.
   - **Inbox key** — the same value as `WA_INBOX_KEY` in the server's `.env`.
   - **Your name** — saved as "added by" on each item.

## Use

- **Right-click** a selection → the form opens with the text filled in.
  On WhatsApp Web every selected message comes in WhatsApp's own copy format,
  one per line, even if you only selected part of a message:
  `[1:40 pm, 3/11/2026] Smit Pansuriya: Let me check.` — "Read more" is
  expanded first so long messages aren't cut, replies show
  `[replying to: "…"]`, and date dividers / bare times are dropped
  (`capture.js`). The form shows "N messages with sender + time"; if it says
  "plain text", WhatsApp's page changed — check the text before adding.
- Or click the toolbar icon and paste text by hand.
- **Company** — nothing is pre-selected. Type to search the company list
  (starting list + every company added so far; your recent ones first), click
  one (or ↑/↓ + Enter). Not in the list → **+ Add new company "…"** adds it to
  CS Platform for everyone.
- **WhatsApp time (IST)** — filled from the first `[1:40 pm, 3/11/2026]` stamp in the text (day/month/year), else now. Change it if needed.
- Adding the same text with the same company and time twice is ignored (shows "Already in the inbox").

After pulling an update, click **Reload** on the extension card in `chrome://extensions`.
