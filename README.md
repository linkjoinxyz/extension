# LinkJoin Extension

Browser extensions for [LinkJoin](https://linkjoin.xyz), available for Chrome and Firefox.

## What they do

- **Pre-meet popup:** a countdown window appears before each scheduled meeting, with a one-click join button and optional password copy
- **Bookmark from anywhere:** add any page to your LinkJoin bookmarks in one click from the extension popup
- **Auth sync:** stays in sync with your LinkJoin session automatically

## Structure

```
chrome/    Chrome extension (Manifest V3)
firefox/   Firefox extension (Manifest V2)
```

## Installation (development)

**Chrome**
1. Go to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select the `chrome/` folder

**Firefox**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select any file inside the `firefox/` folder

## Publishing

- Chrome: [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
- Firefox: [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)

Zip the relevant folder and upload as a new version.

## Contributing

PRs go to `dev`. See [linkjoinxyz/app](https://github.com/linkjoinxyz/app) for the main web app.
