# NanoMarks (AI Bookmark Manager)

Use your browser's built-in, on-device AI (Gemini Nano) to automatically categorize, summarize, and organize your entire bookmark collection. Your bookmarks are a mess; this extension fixes them.

All processing is done **100% locally** on your machine. Your data, URLs, and browsing habits never leave your computer. 🔒

---

## Features

* **On-Device AI Analysis:** Uses Chrome's built-in `LanguageModel` API to analyze your bookmarks without sending data to a server.
* **Smart Multi-Categorization:** Automatically assigns one or more relevant, pre-seeded categories (like "Programming," "AI," "Utility," "Shopping") to every bookmark, you can also delete these or create your own.
* **AI Summaries:** Generates a clean, one-sentence summary for each link based on its title and URL and webpage content(of current page).
* **Persistent Caching:** All AI data is saved locally. You only need to scan bookmarks once. The extension automatically picks up new bookmarks that need analysis.
* **Modern Interface:** A clean, card-based UI that shows the bookmark's favicon, title, base URL, categories, and summary.
* **Advanced Filtering & Search:**
    * Filter your collection by "Status" (like **Unviewed** or **Important**) and by topic.
    * See a live count of how many bookmarks are in each category.
    * Instantly search all bookmark data (title, URL, summary) with a standard text filter.
* **Full Management Tools:**
    * **Prioritize Bookmarks:** Manually **"Star"** any bookmark to mark it as important and filter by your favorites list.
    * **Read-it-Later Queue:** Manually toggle a bookmark's status with an **"Eye"** icon to track what you've read. You can then filter the entire list to show only your "Unviewed" items.
    * **Copy Link Utility:** Instantly copy any bookmark's URL to your clipboard directly from the UI.
    * **Add Current Page:** Instantly add your active tab, watch it get analyzed by the AI in real-time, and see it added to the list.
    * **Delete Sync:** Delete any bookmark directly from the UI, and it's automatically deleted from Chrome.
    * **Export to JSON:** Download your entire AI-enhanced bookmark list (including all your tags and statuses) as a clean JSON file.
    * **Light/Dark Mode:** A persistent light/dark mode toggle.

---

## How to Use

This project runs as an unpacked Chrome extension.

1.  **Load the Extension:**
    * Open Chrome and navigate to `chrome://extensions`.
    * Turn on "Developer mode" (top-right toggle).
    * Click "Load unpacked" and select the folder containing this project's files (`manifest.json`, `popup.html`, etc.).
2.  **Run the First Scan:**
    * Click the extension icon in your Chrome toolbar to open the popup.
    * Click the **"Scan Bookmarks"** button. The extension will begin processing all your uncached bookmarks. This may take some time on the first run.
    * The spinner will stop, and the "All Bookmarks Scanned!" message will appear when it's done.
3.  **Manage Your Bookmarks:**
    * All your analyzed bookmarks will appear instantly every time you open the popup (defaulting to your "Unviewed" list).
    * Use the search bar, status dropdown, or category pills to filter your list.
    * Use the action buttons in the title bar to add your current page or export your data.
    * Use the icons on each card (Star, Eye, Copy, Delete) to manage individual links.
