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
- Or click the toolbar icon and paste text by hand.
- **Group** — pick from the list (groups already in CS Platform + your recent ones) or type a new one.
- **WhatsApp time (IST)** — filled from the first `[14:32, 29/10/2026]` stamp in the text, else now. Change it if needed.
- Adding the same text with the same group and time twice is ignored (shows "Already in the inbox").

After pulling an update, click **Reload** on the extension card in `chrome://extensions`.
