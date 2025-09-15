document.addEventListener('DOMContentLoaded', async () => {
    // --- Get DOM Elements ---
    const scanButton = document.getElementById('scan-button');
    const initScreen = document.getElementById('init-screen');
    const loadingScreen = document.getElementById('loading-screen');
    const loadingStatus = document.getElementById('loading-status');
    const errorScreen = document.getElementById('error-screen');
    const resultsContainer = document.getElementById('results-container');

    // --- Define the JSON Schema for the AI Output ---
    // This schema is based on the new API docs and forces the AI 
    // to return JSON matching this exact structure.
    const AI_RESPONSE_SCHEMA = {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "description": "The single best category for the bookmark (e.g., 'Programming', 'News', 'Shopping', 'Reference', 'Tool', 'Finance', 'Social')."
            },
            "summary": {
                "type": "string",
                "description": "A concise 10-word summary of the website's purpose."
            }
        },
        "required": ["category", "summary"]
    };


    // --- 1. Check for AI Availability (using new API) ---
    // Make sure the LanguageModel API exists
    if (!self.LanguageModel) {
        showError("The LanguageModel API is not available in your browser.");
        return;
    }

    // Check what the model status is
    const aiAvailability = await LanguageModel.availability();

    if (aiAvailability === "unavailable") {
        showError("On-device AI is not available. Check hardware requirements (Need 4GB+ VRAM) and Chrome settings.");
        return;
    }

    if (aiAvailability === "downloading") {
        showLoading("AI model is downloading. Please wait...");
        // The create() call later will monitor the rest of the download
    }
    
    // If "available" or "downloadable", the scan button is functional.

    // --- 2. Add Button Listener ---
    scanButton.addEventListener('click', async () => {
        // NOTE: Unlike the old API, we no longer need to request 
        // the "aiTextSession" permission. The click itself is the user activation.

        showLoading("Initializing AI session...");
        resultsContainer.innerHTML = ''; // Clear previous results

        const bookmarks = await getAllBookmarks();
        await processBookmarks(bookmarks);
    });

    // --- Helper: UI State Changers ---
    function showLoading(message = "Scanning bookmarks...") {
        initScreen.classList.add('hidden');
        errorScreen.classList.add('hidden');
        loadingScreen.classList.remove('hidden');
        loadingStatus.textContent = message;
    }

    function showError(message) {
        console.error(message);
        initScreen.classList.add('hidden');
        loadingScreen.classList.add('hidden');
        errorScreen.classList.remove('hidden');
        errorScreen.querySelector('p').textContent = message;
    }

    function showResults() {
        initScreen.classList.add('hidden');
        loadingScreen.classList.add('hidden');
        errorScreen.classList.add('hidden');
    }

    // --- Helper: Recursive Bookmark Fetcher (Unchanged) ---
    async function getAllBookmarks() {
        return new Promise((resolve) => {
            const bookmarksList = [];
            chrome.bookmarks.getTree((treeNodes) => {
                function traverse(nodes) {
                    for (const node of nodes) {
                        if (node.url) {
                            bookmarksList.push({ title: node.title, url: node.url });
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

    // --- 3. Core Logic: AI Processing Loop (Rewritten) ---
    async function processBookmarks(bookmarks) {
        let aiSession;
        try {
            // Create the AI session using the new API
            // This includes the download monitor required by the docs
            aiSession = await LanguageModel.create({
                monitor: (progress) => {
                    if (progress.phase === 'download') {
                       const percent = Math.round(progress.downloadedBytes / progress.totalBytes * 100);
                       loadingStatus.textContent = `Downloading AI model: ${percent}%`;
                    } else if (progress.phase === 'load') {
                       loadingStatus.textContent = "Loading model into memory...";
                    }
                },
            });

        } catch (e) {
            showError(`Failed to create AI session: ${e.message}`);
            return;
        }

        const total = bookmarks.length;
        loadingStatus.textContent = `Analyzing 0 / ${total}`;

        let count = 0;
        for (const bookmark of bookmarks) {
            count++;
            loadingStatus.textContent = `Analyzing ${count} / ${total}`;

            try {
                const aiData = await getAiAnalysis(aiSession, bookmark);
                if (aiData) {
                    renderBookmarkCard({ ...bookmark, ...aiData });
                }
            } catch (error) {
                console.warn(`Failed to process ${bookmark.url}: ${error.message}`);
            }
        }
        
        showResults();
        aiSession.destroy(); // Clean up the session as per the docs
    }

    // --- 4. Core Logic: The AI Prompt (Rewritten) ---
    async function getAiAnalysis(session, bookmark) {
        const prompt = `
            Analyze the bookmark data.
            Title: "${bookmark.title}"
            URL: "${bookmark.url}"
            
            Based on this data, classify it and provide a very short summary.
        `;

        try {
            // This is the new, robust method using the features from the docs.
            // We request a non-streamed response and enforce our JSON schema.
            const response = await session.prompt(prompt, {
                responseConstraint: AI_RESPONSE_SCHEMA
            });
            
            // The response is now a guaranteed valid JSON string.
            // No more regex or string cleaning needed.
            return JSON.parse(response);

        } catch (e) {
            console.error("Failed to parse AI JSON response:", e);
            return null;
        }
    }

    // --- 5. UI Rendering (Unchanged) ---
    function renderBookmarkCard(data) {
        const faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(data.url)}&size=32`;

        const card = document.createElement('div');
        card.className = 'bookmark-card';
        card.innerHTML = `
            <img src="${faviconUrl}" class="card-favicon" alt="favicon">
            <div class="card-content">
                <a href="${data.url}" target="_blank" class="card-title">${data.title || data.url}</a>
                <span class="card-category">${data.category || 'Other'}</span>
                <p class="card-summary">${data.summary || 'No summary available.'}</p>
            </div>
        `;
        resultsContainer.appendChild(card);
    }
});