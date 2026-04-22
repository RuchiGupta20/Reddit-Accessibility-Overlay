# Reddit Accessibility Overlay

Minimal browser extension scaffold for building a Reddit overlay focused on dyslexia and ADHD accessibility features.

## Current structure

- `manifest.json`: Extension entry point
- `src/background/`: Service worker for lifecycle and future messaging
- `src/content/`: Overlay injection and Reddit page hooks
- `src/shared/`: Shared config and storage helpers
- `src/popup/`: Small action popup
- `src/options/`: Settings page

## Load the extension

1. Open Chrome or Edge and go to the extensions page.
2. Turn on developer mode.
3. Choose `Load unpacked`.
4. Select this project folder.

## Local AI summarization

This project includes a local summarization flow so your Groq API key stays out of the extension client code.

1. Copy `.env.local.example` to `.env.local`.
2. Add your `GROQ_API_KEY` to `.env.local`.
3. Start the local summarization server:

   ```bash
   node server/summarize-server.js
   ```

4. Reload the unpacked extension in Chrome or Edge.
5. Open a Reddit post and use the `Summarize this thread` button in the Reading Tools panel.

The `.env.local` file is ignored by git and should not be committed.

## Suggested next steps

1. Add real readability settings in `src/shared/constants.js`.
2. Expand the overlay UI in `src/content/content.js`.
3. Start with one feature at a time, such as focus mode or spacing controls.
