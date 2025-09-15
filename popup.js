document.addEventListener('DOMContentLoaded', async () => {
    // --- Get DOM Elements ---
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

    // --- Hardcoded Category List ---
    const CATEGORY_LIST = [
        "AI", "Art", "Event", "Utility", "Job", "Portfolio", "Programming",
        "Reference", "Shopping", "Social", "Devtool", "Entertainment", "WebDev Agency", "Other"
    ];
    const categorySet = new Set(CATEGORY_LIST);

    // --- AI Schema ---
    const AI_RESPONSE_SCHEMA = {
        "type": "object",
        "properties": {
            "category": { "type": "string", "enum": CATEGORY_LIST },
            "summary": { "type": "string" }
        },
        "required": ["category", "summary"]
    };

    // --- Caching & State Variables ---
    let aiCache = {};
    let uncachedBookmarks = [];
    let masterBookmarkList = [];
    let currentCategoryFilter = 'all';
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
        renderCategoryPills(); 

        const storageResult = await chrome.storage.local.get(CACHE_KEY);
        if (storageResult[CACHE_KEY]) {
            aiCache = storageResult[CACHE_KEY];
        }

        // getAllBookmarks now also fetches the bookmark ID
        const allBookmarks = await getAllBookmarks();
        
        const cachedBookmarks = [];
        uncachedBookmarks = [];
        masterBookmarkList = [];

        for (const bookmark of allBookmarks) {
            if (aiCache[bookmark.url]) {
                const bookmarkData = { ...bookmark, ...aiCache[bookmark.url] }; // bookmark object now has .id
                cachedBookmarks.push(bookmarkData);
            } else {
                uncachedBookmarks.push(bookmark);
            }
        }
        
        masterBookmarkList = cachedBookmarks;
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

    searchBox.addEventListener('input', () => {
        applyFiltersAndRender();
    });

    // --- NEW: Event Listener for Delete Buttons ---
    // We use event delegation, attaching one listener to the parent container
    // This efficiently handles clicks on any delete button, even new ones.
    resultsContainer.addEventListener('click', (e) => {
        // Check if the clicked element is a delete button
        if (e.target.classList.contains('delete-bookmark-btn')) {
            const bookmarkId = e.target.dataset.bookmarkId;
            if (bookmarkId) {
                handleDeleteBookmark(bookmarkId);
            }
        }
    });


    // --- 3. Filter & Render Logic ---
    function applyFiltersAndRender() {
        const searchQuery = searchBox.value.toLowerCase();
        let filteredList = masterBookmarkList;

        if (currentCategoryFilter !== 'all') {
            filteredList = filteredList.filter(item => item.category === currentCategoryFilter);
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

    function renderCategoryPills() {
        categoryPillsContainer.innerHTML = ''; 
        const allButton = createPill('all', 'All');
        if (currentCategoryFilter === 'all') {
            allButton.classList.add('active');
        }
        categoryPillsContainer.appendChild(allButton);

        const sortedCategories = [...categorySet].sort();
        for (const category of sortedCategories) {
            const pillButton = createPill(category, category);
            if (currentCategoryFilter === category) {
                pillButton.classList.add('active');
            }
            categoryPillsContainer.appendChild(pillButton);
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

    // --- 4. Core AI Processing Loop ---
    async function processBookmarks(bookmarksToProcess) {
        showLoading("Initializing AI session...");
        
        const createSession = () => LanguageModel.create({
            outputLanguage: 'en',
            monitor: (p) => {
                if (p.phase === 'download') {
                    loadingStatus.textContent = `Downloading AI model: ${Math.round(p.downloadedBytes / p.totalBytes * 100)}%`;
                } else if (p.phase === 'load') {
                    loadingStatus.textContent = "Loading model into memory...";
                }
            },
        });

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
                try { aiSession = await createSession(); } 
                catch (e) { return showError(`Failed to recreate AI session: ${e.message}`); }
                batchCounter = 0;
            }

            try {
                const aiData = await getAiAnalysis(aiSession, bookmark);
                if (aiData && aiData.category && aiData.summary) {
                    const fullData = { ...bookmark, ...aiData }; // fullData now includes the ID
                    masterBookmarkList.unshift(fullData); 
                    aiCache[bookmark.url] = aiData;
                    await chrome.storage.local.set({ [CACHE_KEY]: aiCache });
                    applyFiltersAndRender(); 
                }
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
    
    // --- NEW: Function to handle the actual delete ---
    async function handleDeleteBookmark(id) {
        if (!confirm("Are you sure you want to permanently delete this bookmark from Chrome? This cannot be undone.")) {
            return;
        }

        // Find the bookmark in our master list to get its URL (so we can clear its cache)
        const bookmarkToRemove = masterBookmarkList.find(b => b.id === id);
        const urlToRemove = bookmarkToRemove ? bookmarkToRemove.url : null;

        try {
            // 1. Call the Chrome API to delete the actual bookmark
            await chrome.bookmarks.remove(id);

            // 2. If successful, remove it from our local state and cache
            if (urlToRemove && aiCache[urlToRemove]) {
                delete aiCache[urlToRemove];
                // Save the updated cache (with the item removed) back to storage
                await chrome.storage.local.set({ [CACHE_KEY]: aiCache });
            }

            // 3. Remove it from the main list in our app
            masterBookmarkList = masterBookmarkList.filter(b => b.id !== id);
            
            // 4. Re-render the UI
            applyFiltersAndRender();

        } catch (e) {
            // This usually happens if the bookmark was already deleted (e.g., in another window)
            showError(`Could not delete bookmark: ${e.message}`);
            
            // Even if the API fails (maybe it was already gone), let's sync our UI
            // and remove it from our lists just in case.
            if (urlToRemove && aiCache[urlToRemove]) {
                 delete aiCache[urlToRemove];
                 await chrome.storage.local.set({ [CACHE_KEY]: aiCache });
            }
            masterBookmarkList = masterBookmarkList.filter(b => b.id !== id);
            applyFiltersAndRender();
        }
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

    // --- MODIFIED: getAllBookmarks now includes the 'id' ---
    async function getAllBookmarks() {
        return new Promise((resolve) => {
            const bookmarksList = [];
            const urlSet = new Set();
            chrome.bookmarks.getTree((treeNodes) => {
                function traverse(nodes) {
                    for (const node of nodes) {
                        if (node.url && !urlSet.has(node.url)) {
                            urlSet.add(node.url);
                            // WE NOW SAVE THE ID ALONG WITH TITLE AND URL
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
            Analyze the following bookmark and classify it into one of the provided categories.
            Title: "${bookmark.title || 'Untitled'}"
            URL: "${bookmark.url}"
            
            Choose the single best category from the required enum list and provide a one-sentence summary.
        `;
        try {
            const response = await session.prompt(prompt, { responseConstraint: AI_RESPONSE_SCHEMA });
            return JSON.parse(response);
        } catch (e) {
            console.error(`AI Error for ${bookmark.url}:`, e);
            return { category: "Other", summary: "Unable to analyze this link." };
        }
    }

    // --- 6. UI Rendering (MODIFIED) ---
    function renderBookmarkCard(data) {
        const faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(data.url)}&size=32`;

        let urlLinkHtml = ''; 
        try {
            const urlObj = new URL(data.url);
            const baseHost = urlObj.hostname.replace(/^www\./, ''); 
            const baseOrigin = urlObj.origin; 
            urlLinkHtml = `<a href="${baseOrigin}" target="_blank" class="card-url">${baseHost}</a>`;
        } catch (e) { /* Fails gracefully */ }

        const card = document.createElement('div');
        card.className = 'bookmark-card';

        // Add the new delete button element with the data-bookmark-id attribute
        card.innerHTML = `
            <img src="${faviconUrl}" class="card-favicon" alt="">
            <div class="card-content">
                <a href="${data.url}" target="_blank" class="card-title">${data.title || data.url}</a>
                ${urlLinkHtml}
                <span class="card-category">${data.category || 'Other'}</span>
                <p class="card-summary">${data.summary || 'No summary available.'}</p>
            </div>
            <button class="delete-bookmark-btn" data-bookmark-id="${data.id}" title="Delete Bookmark">&times;</button>
        `;

        resultsContainer.appendChild(card);
    }
    
    // --- Run the app ---
    initializeApp();
});