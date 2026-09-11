# Install PornCleaner

Download **porncleaner-chrome.zip** from the repository's **Releases** page. It includes the ready-to-use extension and an offline installation guide. No build or terminal commands are needed.

Requires desktop Google Chrome 120 or newer on Windows, macOS, or Linux.

**Cleaning starts immediately when you install.** Existing and future history for listed domains is deleted automatically. Deletion cannot be undone and may sync to your other Chrome devices. You can pause cleaning and add exceptions after installation.

## Installation

1. **Extract the ZIP.** On Windows, right-click it and choose **Extract All**. On macOS, double-click it. On Linux, use your file manager's **Extract** option.
2. Move the extracted **PornCleaner** folder to a permanent place, such as **Documents**. Open **START-HERE.html** inside it for the illustrated guide.
3. Open Chrome, type `chrome://extensions` into the address bar, and press Enter.
4. Turn on **Developer mode** at the top right, then click **Load unpacked**.
5. Inside your **PornCleaner** folder, select **Chrome** and confirm. This is the folder containing `manifest.json`.

```text
PornCleaner/
├── START-HERE.html     Installation guide
├── INSTALL.txt         Plain-text instructions
├── VERSION.txt
└── Chrome/             Select this folder in Chrome
    └── manifest.json
```

The management page opens automatically and cleaning starts. Click Chrome's puzzle-piece icon and pin PornCleaner to the toolbar. Its **Pause cleaning** button pauses automatic deletion. Add **Your exceptions** to keep a domain's history.

Keep the extracted folder in place. Chrome loads the extension from that location.

## Updates

Updates to this ZIP installation are manual. Download and extract the new version. Replace the files inside the original **Chrome** folder with the new **Chrome** files, keeping the original folder location. Open `chrome://extensions` and click **Reload** on PornCleaner. Your saved pause setting and exceptions are retained. You can export your settings from PornCleaner first as a backup.

## Troubleshooting

- **“Manifest file is missing”:** extract the ZIP and select **PornCleaner → Chrome**, the folder containing `manifest.json`.
- **Developer mode or Load unpacked is missing:** an organization may manage Chrome; ask its administrator.
- **On a phone or tablet:** this package requires desktop Chrome.
- **Need to remove it:** open `chrome://extensions`, find PornCleaner, and click **Remove**. Previously deleted history cannot be restored by the extension.

The ZIP method uses Chrome's Developer mode. The standard click-to-install flow requires Chrome Web Store distribution. See [Chrome's installation instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) and [distribution guidance](https://developer.chrome.com/docs/extensions/how-to/distribute).
