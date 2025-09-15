document.addEventListener('DOMContentLoaded', async () => {
    // --- Get DOM Elements (Added Add Page Button) ---
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
    const addPageButton = document.getElementById('add-current-bookmark'); // <-- NEW

    // --- Theme Toggle Logic ---
    const THEME_KEY = 'themeMode';
    chrome.storage.local.get([THEME_KEY], (result) => {
        if (result[THEME_KEY] === 'dark') {
            bodyEl.classList.add('dark-mode');
            themeToggle.checked = true;
        }
    });
    themeToggle.addEventListener('change', () => {
        if (themeToggle.checked) {
            bodyEl.classList.add('dark-mode');
            chrome.storage.local.set({ [THEME_KEY]: 'dark' });
        } else {
            bodyEl.classList.remove('dark-mode');
            chrome.storage.local.set({ [THEME_KEY]: 'light' });
        }
    });

    // --- Category List ---
    const CATEGORY_LIST = [
        "AI", "Art", "Event", "Utility", "Job", "Portfolio", "Programming",
        "Reference", "Shopping", "Social", "Devtool", "Entertainment", "WebDev Agency", "Other"
    ];
    const categorySet = new Set(CATEGORY_LIST);

    // --- AI Schema ---
    const AI_CAT_SCHEMA = {
        "type": "object",
        "properties": {
            "category": { "type": "array", "items": { "type": "string", "enum": CATEGORY_LIST } },
            "summary": { "type": "string" }
        },
        "required": ["category", "summary"]
    };

    // --- Caching & State Variables ---
    let aiCache = {};
    let uncachedBookmarks = [];
    let masterBookmarkList = [];
    let currentCategoryFilter = 'all';
    let categoryCounts = new Map(); 
    const CACHE_KEY = 'aiBookmarkCache';

    // --- Reset Button Listener ---
    resetButton.addEventListener('click', async () => {
        const areYouSure = confirm("Are you sure you want to delete all cached data?\n\nAll bookmarks will need to be re-scanned.");
        if (!areYouSure) return;
        try {
            await chrome.storage.local.remove(CACHE_KEY);
            window.location.reload();
        } catch (e) {
            showError(`Failed to clear cache: ${e.message}`);
        }
    });

    // --- 1. Main Initialization Function ---
    async function initializeApp() {
        if (!self.LanguageModel) {
            return showError("The LanguageModel API is not available in your browser.");
        }
        const aiAvailability = await LanguageModel.availability();
        if (aiAvailability === "unavailable") {
            return showError("On-device AI is not available. Check hardware requirements (4GB+ VRAM).");
        }

        showLoading("Loading saved progress...");
        
        // --- NEW: Check status of current tab to see if we can add it ---
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
                const bookmarkData = { ...bookmark, ...aiCache[bookmark.url] };
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

    // --- 2. Event Listeners ---
    scanButton.addEventListener('click', () => {
        if (uncachedBookmarks.length > 0) {
            processBookmarks(uncachedBookmarks);
        }
    });

    searchBox.addEventListener('input', applyFiltersAndRender);
    exportButton.addEventListener('click', handleExportJSON);
    addPageButton.addEventListener('click', handleAddCurrentPage); // <-- NEW

    
    // --- 3. Filter, Render, & Count Logic ---
    function calculateAllCategoryCounts() {
        categoryCounts = new Map(); 
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
        }
    }

    function applyFiltersAndRender() {
        const searchQuery = searchBox.value.toLowerCase();
        let filteredList = masterBookmarkList;

        if (currentCategoryFilter !== 'all') {
            filteredList = filteredList.filter(item => 
                item.category && item.category.includes(currentCategoryFilter)
            );
        }

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

    function renderCategoryPills(counts) { 
        categoryPillsContainer.innerHTML = ''; 
        
        const allCount = counts.get('all') || 0;
        const allButton = createPill('all', `All (${allCount})`);
        if (currentCategoryFilter === 'all') {
            allButton.classList.add('active');
        }
        categoryPillsContainer.appendChild(allButton);

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

    function renderList(bookmarksToRender) { 
        resultsContainer.innerHTML = "";
        bookmarksToRender.forEach(item => {
            renderBookmarkCard(item);
        });
    }

    // --- 4. Core AI Processing Loop (Categorization) ---
    async function processBookmarks(bookmarksToProcess) { 
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
                
                if (aiData && aiData.summary && Array.isArray(aiData.category) && aiData.category.length > 0) {
                    fullData = { ...bookmark, ...aiData };
                } else {
                     const summary = aiData ? aiData.summary : "Unable to analyze link.";
                     fullData = { ...bookmark, category: ["Other"], summary: summary };
                }

                masterBookmarkList.unshift(fullData); 
                aiCache[bookmark.url] = { category: fullData.category, summary: fullData.summary };
                await chrome.storage.local.set({ [CACHE_KEY]: aiCache });

                categoryCounts.set('all', masterBookmarkList.length); 
                for (const cat of fullData.category) {
                    if (categoryCounts.has(cat)) {
                        categoryCounts.set(cat, categoryCounts.get(cat) + 1);
                    }
                }
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

    // --- NEW: Function to check the status of the current tab on load ---
    async function checkCurrentTabStatus() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            // Disable button for internal URLs
            if (!tab || !tab.url || !tab.url.startsWith('http')) {
                addPageButton.disabled = true;
                addPageButton.title = "This page cannot be bookmarked";
                return;
            }

            // Check if it's already bookmarked by querying the Chrome API
            const searchResults = await chrome.bookmarks.search({ url: tab.url });
            if (searchResults.length > 0) {
                addPageButton.disabled = true;
                addPageButton.title = "Page is already bookmarked";
                addPageButton.innerHTML = `<span class="material-symbols-outlined">check</span>`;
            }
            // else: button remains active and enabled
        } catch (e) {
            console.error("Could not check tab status:", e);
            addPageButton.disabled = true; // Disable on error
        }
    }

    // --- NEW: Function to add the current tab as a bookmark and analyze it ---
    async function handleAddCurrentPage() {
        let tab;
        try {
            [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        } catch(e) {
            return showError("Could not get current tab. Make sure 'tabs' permission is set.");
        }

        if (!tab || !tab.url || !tab.id || !tab.url.startsWith('http')) return;

        addPageButton.disabled = true;
        addPageButton.innerHTML = `<div class="loader-small"></div>`; // Show loading spinner
        
        let newNode, aiSession;
        try {
            // 1. Create the actual bookmark in Chrome
            newNode = await chrome.bookmarks.create({ title: tab.title, url: tab.url });

            // 2. Run our AI analysis on just this new item
            aiSession = await createSession();
            const aiData = await getAiAnalysis(aiSession, newNode);
            aiSession.destroy();

            // 3. Add to our internal state (using the same fallback logic as the main scan)
             let fullData; 
             if (aiData && aiData.summary && Array.isArray(aiData.category) && aiData.category.length > 0) {
                 fullData = { ...newNode, ...aiData };
             } else {
                 const summary = aiData ? aiData.summary : "Unable to analyze link.";
                 fullData = { ...newNode, category: ["Other"], summary: summary };
             }

            // 4. Save to master list and cache
            masterBookmarkList.unshift(fullData);
            aiCache[fullData.url] = { category: fullData.category, summary: fullData.summary };
            await chrome.storage.local.set({ [CACHE_KEY]: aiCache });

            // 5. Update UI (counts, pills, and list)
            calculateAllCategoryCounts();
            renderCategoryPills(categoryCounts);
            applyFiltersAndRender(); // New item will appear at the top

            // 6. Set final success state on button
            addPageButton.innerHTML = `<span class="material-symbols-outlined">check</span>`;
            addPageButton.title = "Bookmarked and Analyzed!";

        } catch (e) {
            // This can fail if the bookmark API fails or AI fails
            showError(`Failed to add bookmark: ${e.message}`);
            // Reset button on failure
            addPageButton.innerHTML = `<span class="material-symbols-outlined">bookmark_add</span>`;
            addPageButton.disabled = false; // Allow retry
            if (aiSession) aiSession.destroy(); // Ensure session is cleaned up on error
        }
    }


    // --- REFACTORED: Moved createSession to the top-level helper scope ---
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

    // --- Other Helper Functions (Unchanged) ---
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

    // --- 6. UI Rendering & Delete Logic ---
    resultsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-bookmark-btn')) {
            const bookmarkId = e.target.dataset.bookmarkId;
            if (bookmarkId) {
                handleDeleteBookmark(bookmarkId);
            }
        }
    });

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
        } else if (data.category) { 
             categoryHtml += `<span class="card-category">${data.category}</span>`;
        } else {
             categoryHtml += `<span class="card-category">Other</span>`;
        }

        const card = document.createElement('div');
        card.className = 'bookmark-card';
        card.innerHTML = `
            <img src="${faviconUrl}" class="card-favicon" alt="">
            <div class="card-content">
                <a href="${data.url}" target="_blank" class="card-title">${data.title || data.url}</a>
                ${urlLinkHtml}
                <div class="card-category-list">
                    ${categoryHtml}
                </div>
                <p class="card-summary">${data.summary || 'No summary available.'}</p>
            </div>
            <button class="delete-bookmark-btn" data-bookmark-id="${data.id}" title="Delete Bookmark">&times;</button>
        `;

        resultsContainer.appendChild(card);
    }
    
    // --- Run the app ---
    initializeApp();
});