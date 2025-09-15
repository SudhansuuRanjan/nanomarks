# AI Bookmark Manager

Use your browser's built-in, on-device AI (Gemini Nano) to automatically categorize, summarize, and organize your entire bookmark collection. Your bookmarks are a mess; this extension fixes them.

All processing is done **100% locally** on your machine. Your data, URLs, and browsing habits never leave your computer. 🔒

-----

## Features

  * **On-Device AI Analysis:** Uses Chrome's built-in `LanguageModel` API to analyze your bookmarks without sending data to a server.
  * **Smart Categorization:** Automatically assigns one or more relevant, hard-coded categories (like "Programming," "AI," "Utility," "Shopping") to every bookmark.
  * **AI Summaries:** Generates a clean, one-sentence summary for each link based on its title and URL.
  * **Persistent Caching:** All AI data is saved locally. You only need to scan bookmarks once. The extension automatically picks up new bookmarks that need analysis.
  * **Modern Interface:** A clean, card-based UI that shows the bookmark's favicon, title, base URL, categories, and summary.
  * **Instant Filter & Search:**
      * Filter your entire collection by dynamically-generated category pills.
      * See a live count of how many bookmarks are in each category.
      * Instantly search all bookmark data (title, URL, summary) with a standard filter.
  * **Full Management Tools:**
      * **Add Current Page:** Instantly add your active tab, watch it get analyzed by the AI in real-time, and see it added to the list.
      * **Delete Sync:** Delete any bookmark directly from the UI, and it's automatically deleted from Chrome.
      * **Export to JSON:** Download your entire AI-enhanced bookmark list as a clean JSON file.
      * **Light/Dark Mode:** A persistent light/dark mode toggle.

-----

## How to Use

This project runs as an unpacked Chrome extension.

1.  **Load the Extension:**
      * Open Chrome and navigate to `chrome://extensions`.
      * Turn on "Developer mode" (top-right toggle).
      * Click "Load unpacked" and select the folder containing this project's files (`manifest.json`, `popup.html`, etc.).
2.  **Run the First Scan:**
      * Click the extension icon in your Chrome toolbar to open the popup.
      * Click the **"Scan Bookmarks"** button. The extension will begin processing all your uncached bookmarks. This may take some time on the first run.
      * The spinner will stop, and the "All Bookmarks Scanned\!" message will appear when it's done.
3.  **Manage Your Bookmarks:**
      * All your analyzed bookmarks will appear instantly every time you open the popup.
      * Use the search bar or click the category pills to filter your list.
      * Use the action buttons in the title bar to add your current page or export your data.