document.addEventListener('DOMContentLoaded', async () => {
    // --- Get DOM Elements (Added View Filter) ---
    const scanButton = document.getElementById('scan-button');
    const initScreen = document.getElementById('init-screen');
    const loadingScreen = document.getElementById('loading-screen');
    const loadingStatus = document.getElementById('loading-status');
    const errorScreen = document.getElementById('error-screen');
    const resultsContainer = document.getElementById('results-container');
    const searchBox = document.getElementById('search-box');
    const categoryPillsContainer = document.getElementById('category-filter-pills');
    const resultsCountEl = document.getElementById('results-count');
    const resetButton = document.getElementById('reset-button');
    const themeToggle = document.getElementById('theme-toggle');
    const bodyEl = document.body;
    const exportButton = document.getElementById('export-button');
    const addPageButton = document.getElementById('add-current-bookmark');
    const viewStatusFilter = document.getElementById('view-status-filter'); // <-- NEW

    // --- Theme Toggle Logic ---
    const THEME_KEY = 'themeMode';
    chrome.storage.local.get([THEME_KEY], (result) => {
        if (result[THEME_KEY] === 'dark') {
            bodyEl.classList.add('dark-mode');
            themeToggle.checked = true;
        }
    });
    themeToggle.addEventListener('change', () => { /* ... (theme logic unchanged) ... */ });

    // --- Category List ---
    const CATEGORY_LIST = [
        "AI", "Art", "Event", "Utility", "Job", "Portfolio", "Programming",
        "Reference", "Shopping", "Social", "Devtool", "Entertainment", "WebDev Agency", "Other"
    ];
    const categorySet = new Set(CATEGORY_LIST);

    // --- AI Schema (Unchanged) ---
    const AI_CAT_SCHEMA = { /* ... (schema unchanged) ... */ };

    // --- Caching & State Variables (Added new filter state) ---
    let aiCache = {};
    let uncachedBookmarks = [];
    let masterBookmarkList = [];
    let currentCategoryFilter = 'all';
    let currentViewFilter = 'all-status'; // <-- NEW: Default set to "all-status"
    let categoryCounts = new Map();
    const CACHE_KEY = 'aiBookmarkCache';

    // --- Reset Button Listener ---
    resetButton.addEventListener('click', async () => { /* ... (logic unchanged) ... */ });

    // --- 1. Main Initialization Function ---
    async function initializeApp() {
        if (!self.LanguageModel) { /* ... (AI checks unchanged) ... */ }
        const aiAvailability = await LanguageModel.availability();
        if (aiAvailability === "unavailable") { /* ... */ }

        showLoading("Loading saved progress...");
        checkCurrentTabStatus();

        const storageResult = await chrome.storage.local.get(CACHE_KEY);
        if (storageResult[CACHE_KEY]) {
            aiCache = storageResult[CACHE_KEY];
        }

        const allBookmarks = await getAllBookmarks();

        const cachedBookmarks = [];
        uncachedBookmarks = [];
        masterBookmarkList = [];

        for (const bookmark of allBookmarks) {
            if (aiCache[bookmark.url]) {
                const cacheData = aiCache[bookmark.url];
                const bookmarkData = {
                    ...bookmark,
                    ...cacheData,
                    isImportant: cacheData.isImportant || false,
                    isViewed: cacheData.isViewed || false
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

    // --- 2. Event Listeners (Added View Filter Listener) ---
    scanButton.addEventListener('click', () => { /* ... (logic unchanged) ... */ });
    searchBox.addEventListener('input', applyFiltersAndRender);
    exportButton.addEventListener('click', handleExportJSON);
    addPageButton.addEventListener('click', handleAddCurrentPage);

    // --- NEW: Listener for the View Status dropdown ---
    viewStatusFilter.addEventListener('change', (e) => {
        currentViewFilter = e.target.value;
        applyFiltersAndRender();
    });


    // --- 3. Filter, Render, & Count Logic ---

    // MODIFIED: Removed count logic for "unviewed"
    function calculateAllCategoryCounts() {
        categoryCounts = new Map();
        let importantCount = 0;
        // let unviewedCount = 0; // <-- REMOVED

        for (const cat of CATEGORY_LIST) {
            categoryCounts.set(cat, 0);
        }
        categoryCounts.set('all', masterBookmarkList.length);

        for (const item of masterBookmarkList) {
            if (item.category && Array.isArray(item.category)) {
                for (const cat of item.category) {
                    if (categoryCounts.has(cat)) {
                        categoryCounts.set(cat, categoryCounts.get(cat) + 1);
                    }
                }
            }
            if (item.isImportant) importantCount++;
            // if (!item.isViewed) unviewedCount++; // <-- REMOVED
        }

        categoryCounts.set('--important', importantCount);
        // categoryCounts.set('--unviewed', unviewedCount); // <-- REMOVED
    }

    // MODIFIED: This function now chains all 3 filters
    function applyFiltersAndRender() {
        const searchQuery = searchBox.value.toLowerCase();
        let filteredList = masterBookmarkList;

        // --- 1. Apply View Status Filter FIRST ---
        if (currentViewFilter === 'unviewed') {
            filteredList = filteredList.filter(item => !item.isViewed);
        } else if (currentViewFilter === 'viewed') {
            filteredList = filteredList.filter(item => item.isViewed);
        }else{
            filteredList = filteredList; // all-status, no filtering
        }
        // else: 'all-status', so we keep the full list

        // --- 2. Apply Category/Important Filter SECOND (on the already filtered list) ---
        if (currentCategoryFilter === '--important') {
            filteredList = filteredList.filter(item => item.isImportant);
        } else if (currentCategoryFilter !== 'all') {
            filteredList = filteredList.filter(item =>
                item.category && item.category.includes(currentCategoryFilter)
            );
        }

        // --- 3. Apply Search Filter THIRD ---
        if (searchQuery.length > 0) {
            filteredList = filteredList.filter(item =>
                (item.title && item.title.toLowerCase().includes(searchQuery)) ||
                (item.summary && item.summary.toLowerCase().includes(searchQuery)) ||
                (item.url && item.url.toLowerCase().includes(searchQuery))
            );
        }

        renderList(filteredList);
        resultsCountEl.textContent = `${filteredList.length} results found`;
    }

    // MODIFIED: Removed the "Unviewed" pill creation
    function renderCategoryPills(counts) {
        categoryPillsContainer.innerHTML = '';

        const allCount = counts.get('all') || 0;
        const allButton = createPill('all', `All (${allCount})`);
        if (currentCategoryFilter === 'all') allButton.classList.add('active');
        categoryPillsContainer.appendChild(allButton);

        const impCount = counts.get('--important') || 0;
        if (impCount > 0) {
            const impButton = createPill('--important', `Important (${impCount})`);
            if (currentCategoryFilter === '--important') impButton.classList.add('active');
            categoryPillsContainer.appendChild(impButton);
        }

        // "Unviewed" button creation logic is now REMOVED

        const sortedCategories = [...categorySet].sort();
        for (const category of sortedCategories) {
            const count = counts.get(category) || 0;
            if (count > 0 || category === "Other") {
                const pillButton = createPill(category, `${category} (${count})`);
                if (currentCategoryFilter === category) {
                    pillButton.classList.add('active');
                }
                categoryPillsContainer.appendChild(pillButton);
            }
        }
    }

    // Unchanged
    function createPill(id, text) {
        const button = document.createElement('button');
        button.className = 'category-pill';
        button.dataset.category = id;
        button.textContent = text;
        button.addEventListener('click', (e) => {
            const currentActive = categoryPillsContainer.querySelector('.active');
            if (currentActive) {
                currentActive.classList.remove('active');
            }
            e.target.classList.add('active');
            currentCategoryFilter = id;
            applyFiltersAndRender();
        });
        return button;
    }

    // Unchanged
    function renderList(bookmarksToRender) {
        resultsContainer.innerHTML = "";
        bookmarksToRender.forEach(item => {
            renderBookmarkCard(item);
        });
    }

    // --- 4. Core AI Processing Loop (Unchanged) ---
    async function processBookmarks(bookmarksToProcess) {
        // ... (This entire function is identical to the previous step)
        // It correctly adds { isImportant: false, isViewed: false } to new items.
        showLoading("Initializing AI session...");

        let aiSession;
        try { aiSession = await createSession(); }
        catch (e) { return showError(`Failed to create AI session: ${e.message}`); }

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
                try { aiSession = await createSession(); }
                catch (e) { return showError(`Failed to recreate AI session: ${e.message}`); }
                batchCounter = 0;
            }

            try {
                const aiData = await getAiAnalysis(aiSession, bookmark);
                let fullData;
                let cacheData;

                if (aiData && aiData.summary && Array.isArray(aiData.category) && aiData.category.length > 0) {
                    cacheData = { ...aiData, isImportant: false, isViewed: false };
                } else {
                    const summary = aiData ? aiData.summary : "Unable to analyze link.";
                    cacheData = { category: ["Other"], summary: summary, isImportant: false, isViewed: false };
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
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url || !tab.url.startsWith('http')) {
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
            return showError("Could not get current tab. Make sure 'tabs' permission is set.");
        }
        if (!tab || !tab.url || !tab.id || !tab.url.startsWith('http')) return;

        addPageButton.disabled = true;
        addPageButton.innerHTML = `<div class="loader-small"></div>`;

        let newNode, aiSession;
        try {
            newNode = await chrome.bookmarks.create({ title: tab.title, url: tab.url });
            aiSession = await createSession();
            const aiData = await getAiAnalysis(aiSession, newNode);
            aiSession.destroy();

            let cacheData;
            if (aiData && aiData.summary && Array.isArray(aiData.category) && aiData.category.length > 0) {
                cacheData = { ...aiData, isImportant: false, isViewed: false };
            } else {
                const summary = aiData ? aiData.summary : "Unable to analyze link.";
                cacheData = { category: ["Other"], summary: summary, isImportant: false, isViewed: false };
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
            showError(`Failed to add bookmark: ${e.message}`);
            addPageButton.innerHTML = `<span class="material-symbols-outlined">bookmark_add</span>`;
            addPageButton.disabled = false;
            if (aiSession) aiSession.destroy();
        }
    }

    function createSession() {
        return LanguageModel.create({
            outputLanguage: 'en',
            monitor: (p) => {
                if (p.phase === 'download') {
                    loadingStatus.textContent = `Downloading AI model: ${Math.round(p.downloadedBytes / p.totalBytes * 100)}%`;
                } else if (p.phase === 'load') {
                    loadingStatus.textContent = "Loading model into memory...";
                }
            },
        });
    }

    function handleExportJSON() {
        if (masterBookmarkList.length === 0) {
            alert("No data to export. Please scan your bookmarks first.");
            return;
        }
        const jsonString = JSON.stringify(masterBookmarkList, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ai_bookmarks_export.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function showLoading(message = "Scanning bookmarks...") {
        initScreen.classList.add('hidden');
        errorScreen.classList.add('hidden');
        loadingScreen.classList.remove('hidden');
        loadingStatus.textContent = message;
    }

    function showInitialScreen() {
        loadingScreen.classList.add('hidden');
        errorScreen.classList.add('hidden');
        initScreen.classList.remove('hidden');
    }

    function showError(message) {
        console.error(message);
        initScreen.classList.add('hidden');
        loadingScreen.classList.add('hidden');
        errorScreen.classList.remove('hidden');
        errorScreen.querySelector('p').textContent = message;
    }

    async function getAllBookmarks() {
        return new Promise((resolve) => {
            const bookmarksList = [];
            const urlSet = new Set();
            chrome.bookmarks.getTree((treeNodes) => {
                function traverse(nodes) {
                    for (const node of nodes) {
                        if (node.url && !urlSet.has(node.url) && !node.url.startsWith('chrome://')) {
                            urlSet.add(node.url);
                            bookmarksList.push({ title: node.title, url: node.url, id: node.id });
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

    async function getAiAnalysis(session, bookmark) {
        const prompt = `
            Analyze the following bookmark and classify it.
            Title: "${bookmark.title || 'Untitled'}"
            URL: "${bookmark.url}"
            
            Choose ONE or MORE relevant categories from the required enum list and provide a one-sentence summary.
            Your response MUST be a JSON object matching the required schema.
        `;
        try {
            const response = await session.prompt(prompt, { responseConstraint: AI_CAT_SCHEMA });
            return JSON.parse(response);
        } catch (e) {
            console.error(`AI Error for ${bookmark.url}:`, e);
            return { category: ["Other"], summary: "Unable to analyze this link." };
        }
    }

    // Main Card Action Listener (Unchanged)
    resultsContainer.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.delete-bookmark-btn');
        if (deleteBtn) {
            handleDeleteBookmark(deleteBtn.dataset.bookmarkId);
            return;
        }

        const actionBtn = e.target.closest('.card-action-btn');
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            const url = actionBtn.dataset.url;
            if (!url) return;

            if (action === 'toggle-important') handleToggleImportant(url);
            if (action === 'toggle-viewed') handleToggleViewed(url);
            if (action === 'copy-link') handleCopyLink(url, actionBtn);
        }
    });

    // --- Action Handlers (Unchanged, they correctly rely on the main render functions) ---
    async function handleToggleImportant(url) {
        const item = masterBookmarkList.find(b => b.url === url);
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
        const item = masterBookmarkList.find(b => b.url === url);
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
        navigator.clipboard.writeText(url).then(() => {
            const originalIcon = 'link';
            buttonEl.querySelector('span').textContent = 'check';
            buttonEl.title = "Copied!";
            setTimeout(() => {
                buttonEl.querySelector('span').textContent = originalIcon;
                buttonEl.title = "Copy Link";
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy link: ', err);
        });
    }

    async function handleDeleteBookmark(id) {
        if (!confirm("Are you sure you want to permanently delete this bookmark from Chrome?")) {
            return;
        }
        const bookmarkToRemove = masterBookmarkList.find(b => b.id === id);
        const urlToRemove = bookmarkToRemove ? bookmarkToRemove.url : null;
        try {
            await chrome.bookmarks.remove(id);
            if (urlToRemove && aiCache[urlToRemove]) {
                delete aiCache[urlToRemove];
                await chrome.storage.local.set({ [CACHE_KEY]: aiCache });
            }
            masterBookmarkList = masterBookmarkList.filter(b => b.id !== id);
            calculateAllCategoryCounts();
            renderCategoryPills(categoryCounts);
            applyFiltersAndRender();
        } catch (e) {
            showError(`Could not delete bookmark: ${e.message}`);
            if (urlToRemove) {
                masterBookmarkList = masterBookmarkList.filter(b => b.url !== urlToRemove);
                calculateAllCategoryCounts();
                renderCategoryPills(categoryCounts);
                applyFiltersAndRender();
            }
        }
    }

    // Card Render function (Unchanged)
    function renderBookmarkCard(data) {
        const faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(data.url)}&size=32`;
        let urlLinkHtml = '';
        try {
            const urlObj = new URL(data.url);
            const baseHost = urlObj.hostname.replace(/^www\./, '');
            const baseOrigin = urlObj.origin;
            urlLinkHtml = `<a href="${baseOrigin}" target="_blank" class="card-url">${baseHost}</a>`;
        } catch (e) { /* Fails gracefully */ }

        let categoryHtml = '';
        if (data.category && Array.isArray(data.category)) {
            for (const cat of data.category) {
                categoryHtml += `<span class="card-category">${cat}</span>`;
            }
        } else {
            categoryHtml += `<span class="card-category">Other</span>`;
        }

        const isImportant = data.isImportant || false;
        const isViewed = data.isViewed || false;

        const starIcon = isImportant ? 'star' : 'star_outline';
        const starTitle = isImportant ? 'Unmark as important' : 'Mark as important';
        const starActive = isImportant ? 'important-active' : '';

        const viewIcon = isViewed ? 'visibility' : 'visibility_off';
        const viewTitle = isViewed ? 'Mark as unread' : 'Mark as read';
        const viewActive = isViewed ? 'viewed-active' : '';

        const cardViewedClass = isViewed ? 'is-viewed' : '';

        const card = document.createElement('div');
        card.className = `bookmark-card ${cardViewedClass}`;

        card.innerHTML = `
            <img src="${faviconUrl}" class="card-favicon" alt="">
            <div class="card-content">
                <a href="${data.url}" target="_blank" class="card-title">${data.title || data.url}</a>
                ${urlLinkHtml}
                <div class="card-category-list">
                    ${categoryHtml}
                </div>
                <p class="card-summary">${data.summary || 'No summary available.'}</p>
                
                <div class="card-actions">
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
            </div>
            <button class="delete-bookmark-btn" data-bookmark-id="${data.id}" title="Delete Bookmark">&times;</button>
        `;

        resultsContainer.appendChild(card);
    }

    // --- Run the app ---
    initializeApp();
});