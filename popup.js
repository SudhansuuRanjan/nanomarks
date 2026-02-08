document.addEventListener("DOMContentLoaded", async () => {
  // --- Get DOM Elements ---
  const scanButton = document.getElementById("scan-button");
  const initScreen = document.getElementById("init-screen");
  const loadingScreen = document.getElementById("loading-screen");
  const loadingStatus = document.getElementById("loading-status");
  const errorScreen = document.getElementById("error-screen");
  const resultsContainer = document.getElementById("results-container");
  const searchBox = document.getElementById("search-box");
  const categoryPillsContainer = document.getElementById(
    "category-filter-pills",
  );
  const resultsCountEl = document.getElementById("results-count");
  const resetButton = document.getElementById("reset-button");
  const themeToggle = document.getElementById("theme-toggle");
  const bodyEl = document.body;
  const exportButton = document.getElementById("export-button");
  const addPageButton = document.getElementById("add-current-bookmark");
  const viewStatusFilter = document.getElementById("view-status-filter");
  const sortFilter = document.getElementById("sort-filter");

  // --- NEW: Category Manager DOM Elements ---
  const manageCategoriesBtn = document.getElementById("manage-categories-btn");
  const categoryModalBackdrop = document.getElementById(
    "category-modal-backdrop",
  );
  const closeCategoryModalBtn = document.getElementById(
    "close-category-modal-btn",
  );
  const categoryManagerList = document.getElementById("category-manager-list");
  const newCategoryInput = document.getElementById("new-category-input");
  const addCategoryBtn = document.getElementById("add-category-btn");

  // --- Theme Toggle Logic ---
  const THEME_KEY = "themeMode";
  chrome.storage.local.get([THEME_KEY], (result) => {
    if (result[THEME_KEY] === "dark") {
      bodyEl.classList.add("dark-mode");
      themeToggle.checked = true;
    }
  });
  themeToggle.addEventListener("change", () => {
    if (themeToggle.checked) {
      bodyEl.classList.add("dark-mode");
      chrome.storage.local.set({ [THEME_KEY]: "dark" });
    } else {
      bodyEl.classList.remove("dark-mode");
      chrome.storage.local.set({ [THEME_KEY]: "light" });
    }
  });

  // --- Category List (NOW DYNAMIC) ---
  // This is the default list if one isn't in storage
  const DEFAULT_CATEGORY_LIST = [
    "AI",
    "Art",
    "Event",
    "Utility",
    "Job",
    "Portfolio",
    "Programming",
    "Reference",
    "Shopping",
    "Social",
    "Devtool",
    "Entertainment",
    "WebDev Agency",
    "Other",
  ];
  const CATEGORY_STORAGE_KEY = "userCategories";
  let CATEGORY_LIST = []; // Will be populated by loadCategories()
  let categorySet = new Set(); // Will be populated by loadCategories()

  // --- AI Schema (NOW DYNAMIC) ---
  // We declare it here but define it inside initializeApp() AFTER categories are loaded
  let AI_CAT_SCHEMA = {};

  // --- Caching & State Variables ---
  let aiCache = {};
  let uncachedBookmarks = [];
  let masterBookmarkList = [];
  let currentCategoryFilter = "all";
  let currentViewFilter = "all-status"; // Defaulting to 'all' as per our last change
  let currentSortOrder = "newest"; // Default sort order
  let categoryCounts = new Map();
  const CACHE_KEY = "aiBookmarkCache";

  // --- Virtual Scrolling State ---
  let currentFilteredList = [];
  let renderedCount = 0;
  const BATCH_SIZE = 25; // Render items in batches of 25
  let isLoadingMore = false;
  let scrollObserver = null;

  // --- Reset Button Listener ---
  resetButton.addEventListener("click", async () => {
    // NOTE: Using window.confirm() here as it's a simple, blocking action.
    // In a real-world scenario, a custom modal would be better, but this is fine
    // for this extension's internal tooling.
    const areYouSure = confirm(
      "Are you sure you want to delete all cached data?\n\nAll bookmarks will need to be re-scanned.",
    );
    if (!areYouSure) return;
    try {
      // Clear both the bookmark cache AND the category list
      await chrome.storage.local.remove([CACHE_KEY, CATEGORY_STORAGE_KEY]);
      window.location.reload();
    } catch (e) {
      showError(`Failed to clear cache: ${e.message}`);
    }
  });

  // --- NEW: Helper function to load categories from storage ---
  async function loadCategories() {
    try {
      const result = await chrome.storage.local.get(CATEGORY_STORAGE_KEY);
      if (result[CATEGORY_STORAGE_KEY]) {
        // Key exists! Use the list from storage.
        CATEGORY_LIST = result[CATEGORY_STORAGE_KEY];
      } else {
        // Key does NOT exist. This is the first run.
        // 1. Use the default list.
        CATEGORY_LIST = DEFAULT_CATEGORY_LIST;
        // 2. Save the default list to storage for next time.
        await chrome.storage.local.set({
          [CATEGORY_STORAGE_KEY]: CATEGORY_LIST,
        });
      }
      categorySet = new Set(CATEGORY_LIST);
    } catch (e) {
      console.error("Failed to load categories, using default:", e);
      CATEGORY_LIST = DEFAULT_CATEGORY_LIST;
      categorySet = new Set(CATEGORY_LIST);
    }
  }

  // --- NEW: Helper function to refresh app after category changes ---
  async function refreshAppCategories() {
    // 1. Rebuild the Set
    categorySet = new Set(CATEGORY_LIST);

    // 2. Rebuild the AI Schema (CRITICAL)
    AI_CAT_SCHEMA = {
      type: "object",
      properties: {
        category: {
          type: "array",
          items: { type: "string", enum: CATEGORY_LIST }, // Use the updated list
          description:
            "An array of one or more relevant categories for this bookmark.",
        },
        summary: { type: "string" },
      },
      required: ["category", "summary"],
    };

    // 3. Re-calculate counts and re-render pills
    calculateAllCategoryCounts();
    renderCategoryPills(categoryCounts);
    applyFiltersAndRender();
  }

  // --- 1. Main Initialization Function (MODIFIED) ---
  // --- 1. Main Initialization Function (FIXED) ---
  async function initializeApp() {
    if (!self.LanguageModel) {
      return showError(
        "The LanguageModel API is not available in your browser.",
      );
    }

    // --- REMOVED THE BLOCKING AVAILABILITY CHECK ---
    // The createSession() function, called by scan/add,
    // will handle the download and show progress via its monitor.
    // This allows the popup UI to load instantly.

    showLoading("Loading saved progress...");

    // --- MODIFIED: Load categories FIRST ---
    await loadCategories();

    // --- MODIFIED: Define AI_CAT_SCHEMA *after* categories are loaded ---
    AI_CAT_SCHEMA = {
      type: "object",
      properties: {
        category: {
          type: "array",
          items: { type: "string", enum: CATEGORY_LIST },
          description:
            "An array of one or more relevant categories for this bookmark.",
        },
        summary: { type: "string" },
      },
      required: ["category", "summary"],
    };
    // --- End of modification ---

    checkCurrentTabStatus();

    const storageResult = await chrome.storage.local.get(CACHE_KEY);
    if (storageResult[CACHE_KEY]) {
      aiCache = storageResult[CACHE_KEY];
    }

    const allBookmarks = await getAllBookmarks(); // This list now contains 'dateAdded'

    const cachedBookmarks = [];
    uncachedBookmarks = [];
    masterBookmarkList = [];

    for (const bookmark of allBookmarks) {
      if (aiCache[bookmark.url]) {
        const cacheData = aiCache[bookmark.url];
        const bookmarkData = {
          ...bookmark, // bookmark object now has .id AND .dateAdded
          ...cacheData,
          isImportant: cacheData.isImportant || false,
          isViewed: cacheData.isViewed || false,
        };
        cachedBookmarks.push(bookmarkData);
      } else {
        uncachedBookmarks.push(bookmark);
      }
    }

    masterBookmarkList = cachedBookmarks;

    calculateAllCategoryCounts();
    renderCategoryPills(categoryCounts);
    applyFiltersAndRender();

    showInitialScreen();
    scanButton.textContent = `Scan ${uncachedBookmarks.length} New Bookmarks`;
    if (uncachedBookmarks.length === 0) {
      scanButton.disabled = true;
      scanButton.textContent = "All Bookmarks Scanned!";
    }
  }

  // --- 2. Event Listeners (MODIFIED) ---
  scanButton.addEventListener("click", () => {
    if (uncachedBookmarks.length > 0) {
      processBookmarks(uncachedBookmarks);
    }
  });

  searchBox.addEventListener("input", applyFiltersAndRender);
  exportButton.addEventListener("click", handleExportJSON);
  addPageButton.addEventListener("click", handleAddCurrentPage);

  viewStatusFilter.addEventListener("change", (e) => {
    currentViewFilter = e.target.value;
    applyFiltersAndRender();
  });

  sortFilter.addEventListener("change", (e) => {
    currentSortOrder = e.target.value;
    applyFiltersAndRender();
  });

  // --- NEW: Category Modal Listeners ---
  manageCategoriesBtn.addEventListener("click", openCategoryModal);
  closeCategoryModalBtn.addEventListener("click", closeCategoryModal);
  categoryModalBackdrop.addEventListener("click", (e) => {
    // Close if clicking on the backdrop itself
    if (e.target === categoryModalBackdrop) {
      closeCategoryModal();
    }
  });
  addCategoryBtn.addEventListener("click", handleAddCategory);
  // Use event delegation for delete buttons
  categoryManagerList.addEventListener("click", handleDeleteCategory);
  // --- End of new listeners ---

  // --- 3. Filter, Render, & Count Logic ---
  function calculateAllCategoryCounts() {
    categoryCounts = new Map();
    let importantCount = 0;

    // Initialize all *current* categories from CATEGORY_LIST
    for (const cat of CATEGORY_LIST) {
      categoryCounts.set(cat, 0);
    }
    categoryCounts.set("all", masterBookmarkList.length);

    for (const item of masterBookmarkList) {
      if (item.category && Array.isArray(item.category)) {
        for (const cat of item.category) {
          // Only count categories that are still in our master list
          if (categoryCounts.has(cat)) {
            categoryCounts.set(cat, categoryCounts.get(cat) + 1);
          }
          // Note: Bookmarks with deleted categories will just not be counted
          // under that category, but will still appear under "All".
        }
      }
      if (item.isImportant) importantCount++;
    }

    categoryCounts.set("--important", importantCount);
  }

  function applyFiltersAndRender() {
    const searchQuery = searchBox.value.toLowerCase();
    let filteredList = masterBookmarkList;

    if (currentViewFilter === "unviewed") {
      filteredList = filteredList.filter((item) => !item.isViewed);
    } else if (currentViewFilter === "viewed") {
      filteredList = filteredList.filter((item) => item.isViewed);
    }

    if (currentCategoryFilter === "--important") {
      filteredList = filteredList.filter((item) => item.isImportant);
    } else if (currentCategoryFilter !== "all") {
      filteredList = filteredList.filter(
        (item) =>
          item.category && item.category.includes(currentCategoryFilter),
      );
    }

    if (searchQuery.length > 0) {
      filteredList = filteredList.filter(
        (item) =>
          (item.title && item.title.toLowerCase().includes(searchQuery)) ||
          (item.summary && item.summary.toLowerCase().includes(searchQuery)) ||
          (item.url && item.url.toLowerCase().includes(searchQuery)),
      );
    }

    renderList(filteredList);
    resultsCountEl.textContent = `${filteredList.length} results found`;
  }

  function renderCategoryPills(counts) {
    categoryPillsContainer.innerHTML = "";

    const allCount = counts.get("all") || 0;
    const allButton = createPill("all", `All (${allCount})`);
    if (currentCategoryFilter === "all") allButton.classList.add("active");
    categoryPillsContainer.appendChild(allButton);

    const impCount = counts.get("--important") || 0;
    if (impCount > 0) {
      const impButton = createPill("--important", `Important (${impCount})`);
      if (currentCategoryFilter === "--important")
        impButton.classList.add("active");
      categoryPillsContainer.appendChild(impButton);
    }

    // Sort the *current* list of categories
    const sortedCategories = [...categorySet].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    for (const category of sortedCategories) {
      const count = counts.get(category) || 0;
      // Show "Other" even if 0, but other categories only if > 0
      if (count > 0 || category === "Other") {
        const pillButton = createPill(category, `${category} (${count})`);
        if (currentCategoryFilter === category) {
          pillButton.classList.add("active");
        }
        categoryPillsContainer.appendChild(pillButton);
      }
    }
  }

  function createPill(id, text) {
    const button = document.createElement("button");
    button.className = "category-pill";
    button.dataset.category = id;
    button.textContent = text;
    button.addEventListener("click", (e) => {
      const currentActive = categoryPillsContainer.querySelector(".active");
      if (currentActive) {
        currentActive.classList.remove("active");
      }
      e.target.classList.add("active");
      currentCategoryFilter = id;
      applyFiltersAndRender();
    });
    return button;
  }

  // --- Card Creation Function ---
  function createBookmarkCard(data) {
    const faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(data.url)}&size=32`;
    let urlLinkHtml = "";
    try {
      const urlObj = new URL(data.url);
      const baseHost = urlObj.hostname.replace(/^www\./, "");
      const baseOrigin = urlObj.origin;
      urlLinkHtml = `<a href="${baseOrigin}" target="_blank" class="card-url">${baseHost}</a>`;
    } catch (e) {
      /* Fails gracefully */
    }

    let categoryHtml = "";
    if (data.category && Array.isArray(data.category)) {
      for (const cat of data.category) {
        if (categorySet.has(cat)) {
          categoryHtml += `<span class="card-category">${cat}</span>`;
        }
      }
    }
    if (categoryHtml === "") {
      categoryHtml += `<span class="card-category">Other</span>`;
    }

    const isImportant = data.isImportant || false;
    const isViewed = data.isViewed || false;

    const starTitle = isImportant ? "Unmark as important" : "Mark as important";
    const starActive = isImportant ? "important-active" : "";

    const viewIcon = isViewed ? "visibility" : "visibility_off";
    const viewTitle = isViewed ? "Mark as unread" : "Mark as read";
    const viewActive = isViewed ? "viewed-active" : "";

    const cardViewedClass = isViewed ? "is-viewed" : "";

    let formattedDate = "";
    if (data.dateAdded) {
      formattedDate = new Date(data.dateAdded).toLocaleDateString();
    }

    const card = document.createElement("div");
    card.className = `bookmark-card ${cardViewedClass}`;

    card.innerHTML = `
      <img src="${faviconUrl}" class="card-favicon" alt="">
      <div class="card-content">
        <a href="${data.url}" target="_blank" class="card-title">${data.title || data.url}</a>
        ${urlLinkHtml}
        <div class="card-category-list">
          ${categoryHtml}
        </div>
        <p class="card-summary">${data.summary || "No summary available."}</p>
        <div class="card-actions">
          <div class="card-action-buttons">
            <button class="card-action-btn ${starActive}" data-action="toggle-important" data-url="${data.url}" title="${starTitle}">
              <span class="material-symbols-outlined">star</span>
            </button>
            <button class="card-action-btn ${viewActive}" data-action="toggle-viewed" data-url="${data.url}" title="${viewTitle}">
              <span class="material-symbols-outlined">${viewIcon}</span>
            </button>
            <button class="card-action-btn" data-action="copy-link" data-url="${data.url}" title="Copy Link">
              <span class="material-symbols-outlined">link</span>
            </button>
          </div>
          <span class="card-date">Added: ${formattedDate}</span>
        </div>
      </div>
      <button class="delete-bookmark-btn" data-bookmark-id="${data.id}" title="Delete Bookmark">&times;</button>
    `;

    return card;
  }

  function renderList(bookmarksToRender) {
    // Clean up previous observer
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }

    resultsContainer.innerHTML = "";
    renderedCount = 0;
    isLoadingMore = false;

    // Sort the list based on current sort order
    if (currentSortOrder === "newest") {
      bookmarksToRender.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    } else {
      bookmarksToRender.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0));
    }

    // Store the sorted/filtered list for virtual rendering
    currentFilteredList = bookmarksToRender;

    if (currentFilteredList.length === 0) {
      return;
    }

    // Render initial batch
    renderNextBatch();

    // Set up intersection observer for infinite scroll
    setupScrollObserver();
  }

  function renderNextBatch() {
    if (isLoadingMore || renderedCount >= currentFilteredList.length) {
      return;
    }

    isLoadingMore = true;
    const endIndex = Math.min(renderedCount + BATCH_SIZE, currentFilteredList.length);

    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();

    for (let i = renderedCount; i < endIndex; i++) {
      const card = createBookmarkCard(currentFilteredList[i]);
      fragment.appendChild(card);
    }

    resultsContainer.appendChild(fragment);
    renderedCount = endIndex;
    isLoadingMore = false;
  }

  function setupScrollObserver() {
    // Create a sentinel element at the bottom
    const sentinel = document.createElement("div");
    sentinel.className = "scroll-sentinel";
    sentinel.style.height = "1px";
    resultsContainer.appendChild(sentinel);

    scrollObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && renderedCount < currentFilteredList.length) {
            // Remove the old sentinel
            sentinel.remove();

            // Render next batch
            renderNextBatch();

            // Add sentinel back at the bottom if there are more items
            if (renderedCount < currentFilteredList.length) {
              resultsContainer.appendChild(sentinel);
            }
          }
        });
      },
      {
        root: null, // Use the viewport (document scroll)
        rootMargin: "200px", // Trigger 200px before reaching the bottom
        threshold: 0,
      }
    );

    scrollObserver.observe(sentinel);
  }

  // --- 4. Core AI Processing Loop (Categorization) ---
  async function processBookmarks(bookmarksToProcess) {
    showLoading("Initializing AI session...");

    let aiSession;
    try {
      aiSession = await createSession();
    } catch (e) {
      return showError(`Failed to create AI session: ${e.message}`);
    }

    const total = bookmarksToProcess.length;
    let count = 0;
    let batchCounter = 0;
    const BATCH_SIZE = 30;

    for (const bookmark of bookmarksToProcess) {
      count++;
      loadingStatus.textContent = `Analyzing new items: ${count} / ${total}`;

      if (batchCounter >= BATCH_SIZE) {
        loadingStatus.textContent = `Resetting AI session...`;
        aiSession.destroy();
        try {
          aiSession = await createSession();
        } catch (e) {
          return showError(`Failed to recreate AI session: ${e.message}`);
        }
        batchCounter = 0;
      }

      try {
        const aiData = await getAiAnalysis(aiSession, bookmark);
        let fullData;
        let cacheData;

        if (
          aiData &&
          aiData.summary &&
          Array.isArray(aiData.category) &&
          aiData.category.length > 0
        ) {
          // NEW: Filter AI response to only include *valid* categories
          const validCategories = aiData.category.filter((cat) =>
            categorySet.has(cat),
          );

          if (validCategories.length > 0) {
            cacheData = {
              ...aiData,
              category: validCategories,
              isImportant: false,
              isViewed: false,
            };
          } else {
            // AI gave weird categories, default to "Other"
            cacheData = {
              ...aiData,
              category: ["Other"],
              isImportant: false,
              isViewed: false,
            };
          }
        } else {
          const summary = aiData ? aiData.summary : "Unable to analyze link.";
          cacheData = {
            category: ["Other"],
            summary: summary,
            isImportant: false,
            isViewed: false,
          };
        }

        fullData = { ...bookmark, ...cacheData };
        masterBookmarkList.unshift(fullData);
        aiCache[bookmark.url] = cacheData;
        await chrome.storage.local.set({ [CACHE_KEY]: aiCache });

        calculateAllCategoryCounts();
        renderCategoryPills(categoryCounts);
        applyFiltersAndRender();
      } catch (error) {
        console.warn(`Failed to process ${bookmark.url}: ${error.message}`);
      }
      batchCounter++;
    }

    aiSession.destroy();
    scanButton.textContent = "All Bookmarks Scanned!";
    scanButton.disabled = true;
    showInitialScreen();
  }

  // --- 5. Helper Functions ---
  async function checkCurrentTabStatus() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab || !tab.url || !tab.url.startsWith("http")) {
        addPageButton.disabled = true;
        addPageButton.title = "This page cannot be bookmarked";
        return;
      }
      const searchResults = await chrome.bookmarks.search({ url: tab.url });
      if (searchResults.length > 0) {
        addPageButton.disabled = true;
        addPageButton.title = "Page is already bookmarked";
        addPageButton.innerHTML = `<span class="material-symbols-outlined">check</span>`;
      }
    } catch (e) {
      console.error("Could not check tab status:", e);
      addPageButton.disabled = true;
    }
  }

  async function handleAddCurrentPage() {
    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (e) {
      return showError(
        "Could not get current tab. Make sure 'tabs' permission is set.",
      );
    }
    if (!tab || !tab.url || !tab.id || !tab.url.startsWith("http")) return;

    addPageButton.disabled = true;
    addPageButton.innerHTML = `<div class="loader-small"></div>`; // This function will be injected into the active tab to scrape its content.

    function scrapePageContent() {
      // Try to find the main content, fall back to the whole body
      const mainEl = document.querySelector("main");
      const articleEl = document.querySelector("article");
      let content = "";
      if (articleEl) {
        content = articleEl.innerText;
      } else if (mainEl) {
        content = mainEl.innerText;
      } else if (document.body) {
        content = document.body.innerText;
      } else {
        content = ""; // Fallback for pages without a body
      } // Clean up excessive whitespace and limit size to avoid overwhelming the model

      const cleanedContent = content.replace(/\s+/g, " ").trim(); // Limit to ~4k characters to avoid token limits
      return cleanedContent.substring(0, 4000);
    }

    let newNode, aiSession;
    try {
      // --- Step 1: Scrape page content ---
      let pageContent = null;
      try {
        const injectionResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrapePageContent,
        }); // executeScript returns an array of results
        if (
          injectionResults &&
          injectionResults[0] &&
          injectionResults[0].result
        ) {
          pageContent = injectionResults[0].result;
        }
      } catch (scriptError) {
        console.warn(
          `Could not scrape page content: ${scriptError.message}. Proceeding with URL/title only.`,
        ); // This can fail on protected pages (like the Chrome Web Store).
        // We'll just continue without the content, which is fine.
      } // --- Step 2: Create the bookmark (unchanged) ---

      newNode = await chrome.bookmarks.create({
        title: tab.title,
        url: tab.url,
      }); // --- Step 3: Run AI Analysis (MODIFIED) ---

      aiSession = await createSession(); // Pass the scraped pageContent to the analysis function
      const aiData = await getAiAnalysis(aiSession, newNode, pageContent);
      aiSession.destroy(); // --- Step 4: Process results (unchanged) ---

      let cacheData;
      if (
        aiData &&
        aiData.summary &&
        Array.isArray(aiData.category) &&
        aiData.category.length > 0
      ) {
        const validCategories = aiData.category.filter((cat) =>
          categorySet.has(cat),
        );
        if (validCategories.length > 0) {
          cacheData = {
            ...aiData,
            category: validCategories,
            isImportant: false,
            isViewed: false,
          };
        } else {
          cacheData = {
            ...aiData,
            category: ["Other"],
            isImportant: false,
            isViewed: false,
          };
        }
      } else {
        const summary = aiData ? aiData.summary : "Unable to analyze link.";
        cacheData = {
          category: ["Other"],
          summary: summary,
          isImportant: false,
          isViewed: false,
        };
      }
      const fullData = { ...newNode, ...cacheData };

      masterBookmarkList.unshift(fullData);
      aiCache[fullData.url] = cacheData;
      await chrome.storage.local.set({ [CACHE_KEY]: aiCache });

      calculateAllCategoryCounts();
      renderCategoryPills(categoryCounts);
      applyFiltersAndRender();

      addPageButton.innerHTML = `<span class="material-symbols-outlined">check</span>`;
      addPageButton.title = "Bookmarked and Analyzed!";
    } catch (e) {
      // This error handler now catches errors from scripting, bookmarking, or AI
      showError(`Failed to add bookmark: ${e.message}`);
      addPageButton.innerHTML = `<span class="material-symbols-outlined">bookmark_add</span>`;
      addPageButton.disabled = false;
      if (aiSession) aiSession.destroy();
    }
  }

  function createSession() {
    return LanguageModel.create({
      expectedInputs: [
        {
          type: "text",
          languages: ["en"],
        },
      ],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      monitor: (p) => {
        if (p.phase === "download") {
          loadingStatus.textContent = `Downloading AI model: ${Math.round((p.downloadedBytes / p.totalBytes) * 100)}%`;
        } else if (p.phase === "load") {
          loadingStatus.textContent = "Loading model into memory...";
        }
      },
    });
  }

  function handleExportJSON() {
    if (masterBookmarkList.length === 0) {
      // Use a custom alert/modal in a real app
      alert("No data to export. Please scan your bookmarks first.");
      return;
    }
    const jsonString = JSON.stringify(masterBookmarkList, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ai_bookmarks_export.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function showLoading(message = "Scanning bookmarks...") {
    initScreen.classList.add("hidden");
    errorScreen.classList.add("hidden");
    loadingScreen.classList.remove("hidden");
    loadingStatus.textContent = message;
  }

  function showInitialScreen() {
    loadingScreen.classList.add("hidden");
    errorScreen.classList.add("hidden");
    initScreen.classList.remove("hidden");
  }

  function showError(message) {
    console.error(message);
    initScreen.classList.add("hidden");
    loadingScreen.classList.add("hidden");
    errorScreen.classList.remove("hidden");
    errorScreen.querySelector("p").textContent = message;
  }

  // --- MODIFIED: getAllBookmarks now includes 'dateAdded' ---
  async function getAllBookmarks() {
    return new Promise((resolve) => {
      const bookmarksList = [];
      const urlSet = new Set();
      chrome.bookmarks.getTree((treeNodes) => {
        function traverse(nodes) {
          for (const node of nodes) {
            if (
              node.url &&
              !urlSet.has(node.url) &&
              !node.url.startsWith("chrome://")
            ) {
              urlSet.add(node.url);
              // ADDED node.dateAdded HERE
              bookmarksList.push({
                title: node.title,
                url: node.url,
                id: node.id,
                dateAdded: node.dateAdded, // Get the timestamp
              });
            }
            if (node.children) {
              traverse(node.children);
            }
          }
        }
        traverse(treeNodes);
        resolve(bookmarksList);
      });
    });
  }

  async function getAiAnalysis(session, bookmark, pageContent = null) {
    // Dynamically build the prompt based on available content
    let promptContext = `
              Analyze the following bookmark and classify it.
              Title: "${bookmark.title || "Untitled"}"
              URL: "${bookmark.url}"
      `;

    // THIS IS THE DYNAMIC PART:
    // If pageContent is provided (not null), add it to the prompt.
    if (pageContent) {
      promptContext += `

          The content of the page is as follows:
          """
          ${pageContent}
          """
        `;
    }

    const prompt = `
              ${promptContext}

              Based on all the available information (title, URL, and page content if provided),
              choose ONE or MORE relevant categories from the required enum list and provide a
              concise one-sentence summary that captures the main purpose of the page.
              Your response MUST be a JSON object matching the required schema.
          `;
    try {
      // Use the dynamically defined AI_CAT_SCHEMA
      const response = await session.prompt(prompt, {
        responseConstraint: AI_CAT_SCHEMA,
      });
      return JSON.parse(response);
    } catch (e) {
      console.error(`AI Error for ${bookmark.url}:`, e);
      return { category: ["Other"], summary: "Unable to analyze this link." };
    }
  }

  // --- 6. UI Rendering & Action Click Handlers ---
  resultsContainer.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".delete-bookmark-btn");
    if (deleteBtn) {
      handleDeleteBookmark(deleteBtn.dataset.bookmarkId);
      return;
    }

    const actionBtn = e.target.closest(".card-action-btn");
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      const url = actionBtn.dataset.url;
      if (!url) return;

      if (action === "toggle-important") handleToggleImportant(url);
      if (action === "toggle-viewed") handleToggleViewed(url);
      if (action === "copy-link") handleCopyLink(url, actionBtn);
    }
  });

  async function handleToggleImportant(url) {
    const item = masterBookmarkList.find((b) => b.url === url);
    if (!item) return;
    item.isImportant = !item.isImportant;
    if (!aiCache[url]) aiCache[url] = {};
    aiCache[url].isImportant = item.isImportant;
    await chrome.storage.local.set({ [CACHE_KEY]: aiCache });
    calculateAllCategoryCounts();
    renderCategoryPills(categoryCounts);
    applyFiltersAndRender();
  }

  async function handleToggleViewed(url) {
    const item = masterBookmarkList.find((b) => b.url === url);
    if (!item) return;
    item.isViewed = !item.isViewed;
    if (!aiCache[url]) aiCache[url] = {};
    aiCache[url].isViewed = item.isViewed;
    await chrome.storage.local.set({ [CACHE_KEY]: aiCache });
    calculateAllCategoryCounts();
    renderCategoryPills(categoryCounts);
    applyFiltersAndRender();
  }

  function handleCopyLink(url, buttonEl) {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        const originalIcon = "link";
        buttonEl.querySelector("span").textContent = "check";
        buttonEl.title = "Copied!";
        setTimeout(() => {
          buttonEl.querySelector("span").textContent = originalIcon;
          buttonEl.title = "Copy Link";
        }, 1500);
      })
      .catch((err) => {
        console.error("Failed to copy link: ", err);
      });
  }

  async function handleDeleteBookmark(id) {
    if (
      !confirm(
        "Are you sure you want to permanently delete this bookmark from Chrome?",
      )
    ) {
      return;
    }
    const bookmarkToRemove = masterBookmarkList.find((b) => b.id === id);
    const urlToRemove = bookmarkToRemove ? bookmarkToRemove.url : null;
    try {
      await chrome.bookmarks.remove(id);
      if (urlToRemove && aiCache[urlToRemove]) {
        delete aiCache[urlToRemove];
        await chrome.storage.local.set({ [CACHE_KEY]: aiCache });
      }
      masterBookmarkList = masterBookmarkList.filter((b) => b.id !== id);

      calculateAllCategoryCounts();
      renderCategoryPills(categoryCounts);
      applyFiltersAndRender();
    } catch (e) {
      showError(`Could not delete bookmark: ${e.message}`);
      // This is a failsafe in case chrome.bookmarks.remove fails
      // but we still want to remove it from our view.
      if (urlToRemove) {
        masterBookmarkList = masterBookmarkList.filter(
          (b) => b.url !== urlToRemove,
        );
        calculateAllCategoryCounts();
        renderCategoryPills(categoryCounts);
        applyFiltersAndRender();
      }
    }
  }

  // --- NEW: Section 7. Category Manager Functions ---

  /**
   * Renders the list of categories inside the management modal.
   */
  function renderCategoryManagerList() {
    categoryManagerList.innerHTML = "";
    const sortedList = [...CATEGORY_LIST].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );

    for (const category of sortedList) {
      // The "Other" category is essential and cannot be deleted
      const isOther = category === "Other";
      const deleteBtnHtml = isOther
        ? `<span class="material-symbols-outlined" style="opacity: 0.3; font-size: 20px; color: var(--text-color-light);" title="Cannot delete default category">block</span>`
        : `<button class="category-delete-btn" data-category="${category}" title="Delete category">
             <span class="material-symbols-outlined">delete</span>
           </button>`;

      const item = document.createElement("div");
      item.className = "category-manager-item";
      item.innerHTML = `
        <span>${category}</span>
        ${deleteBtnHtml}
      `;
      categoryManagerList.appendChild(item);
    }
  }

  /**
   * Opens the category management modal.
   */
  function openCategoryModal() {
    renderCategoryManagerList();
    categoryModalBackdrop.classList.remove("hidden");
    newCategoryInput.value = ""; // Clear input
    newCategoryInput.focus();
  }

  /**
   * Closes the category management modal.
   */
  function closeCategoryModal() {
    categoryModalBackdrop.classList.add("hidden");
  }

  /**
   * Handles the "Add" button click to create a new category.
   */
  async function handleAddCategory() {
    const newCategoryName = newCategoryInput.value.trim();

    if (!newCategoryName) {
      return; // Do nothing if empty
    }

    if (categorySet.has(newCategoryName)) {
      alert("This category already exists.");
      return;
    }

    // 1. Update local state
    CATEGORY_LIST.push(newCategoryName);
    categorySet.add(newCategoryName);

    // 2. Persist to storage
    try {
      await chrome.storage.local.set({
        [CATEGORY_STORAGE_KEY]: CATEGORY_LIST,
      });

      // 3. Re-render the modal list
      newCategoryInput.value = "";
      renderCategoryManagerList();

      // 4. Refresh the main app UI
      await refreshAppCategories();
    } catch (e) {
      showError(`Failed to save new category: ${e.message}`);
      // Rollback state on failure
      CATEGORY_LIST.pop();
      categorySet.delete(newCategoryName);
    }
  }

  /**
   * Handles clicks on the delete buttons within the category modal.
   */
  async function handleDeleteCategory(e) {
    const deleteBtn = e.target.closest(".category-delete-btn");
    if (!deleteBtn) return; // Click wasn't on a delete button

    const categoryToDelete = deleteBtn.dataset.category;
    if (!categoryToDelete || categoryToDelete === "Other") {
      return; // Should not happen, but a good safeguard
    }

    if (
      !confirm(
        `Are you sure you want to delete the "${categoryToDelete}" category?\n\nExisting bookmarks with this category will keep it, but it will be removed from the filter list. This cannot be undone.`,
      )
    ) {
      return;
    }

    const originalList = [...CATEGORY_LIST]; // For rollback

    // 1. Update local state
    CATEGORY_LIST = CATEGORY_LIST.filter((c) => c !== categoryToDelete);
    categorySet.delete(categoryToDelete);

    // 2. Persist to storage
    try {
      await chrome.storage.local.set({
        [CATEGORY_STORAGE_KEY]: CATEGORY_LIST,
      });

      // 3. Re-render the modal list
      renderCategoryManagerList();

      // 4. Refresh the main app UI
      await refreshAppCategories();
    } catch (e) {
      showError(`Failed to delete category: ${e.message}`);
      // Rollback state on failure
      CATEGORY_LIST = originalList;
      categorySet = new Set(originalList);
    }
  }

  // --- Run the app ---
  initializeApp();
});
