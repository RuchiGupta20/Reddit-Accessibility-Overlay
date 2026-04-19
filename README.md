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

## Suggested next steps

1. Add real readability settings in `src/shared/constants.js`.
2. Expand the overlay UI in `src/content/content.js`.
3. Start with one feature at a time, such as focus mode or spacing controls.
