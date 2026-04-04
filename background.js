chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "pingUrl") {
    (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        
        const response = await fetch(request.url, { 
            method: "HEAD", 
            signal: controller.signal 
        });
        clearTimeout(timeoutId);
        
        if (response.status >= 400 && response.status !== 405) {
            const controllerGet = new AbortController();
            const timeoutIdGet = setTimeout(() => controllerGet.abort(), 6000);
            const getResponse = await fetch(request.url, { 
                method: "GET", 
                signal: controllerGet.signal 
            });
            clearTimeout(timeoutIdGet);
            
            if (getResponse.status >= 400) {
                sendResponse({ dead: true });
                return;
            }
        }
        sendResponse({ dead: false });
      } catch (err) {
        // Network timeout, cross-origin hard fail, etc
        sendResponse({ dead: true });
      }
    })();
    return true; // Keep channel open for async response
  }
});

// --- Auto-Scan on Natively Created Bookmarks ---
chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
    // Only process actual URLs, not folders.
    if (!bookmark.url || bookmark.url.startsWith("chrome://")) return;

    try {
        const CACHE_KEY = "nanomarks_ai_cache";
        const CATEGORY_STORAGE_KEY = "nanomarks_categories";
        
        // 1. Get Categories
        const storageData = await chrome.storage.local.get([CATEGORY_STORAGE_KEY, CACHE_KEY]);
        const categories = storageData[CATEGORY_STORAGE_KEY] || ["Read Later", "News", "Technology", "Programming", "Design", "Finance", "Productivity", "Education", "Entertainment", "Other"];
        let aiCache = storageData[CACHE_KEY] || {};

        // Avoid reprocessing if it somehow already exists
        if (aiCache[bookmark.url]) return;

        // 2. See if the active tab matches this bookmark (user clicked star button)
        let pageContent = null;
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs.length > 0 && tabs[0].url === bookmark.url) {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    func: () => {
                        const mainEl = document.querySelector("main");
                        const articleEl = document.querySelector("article");
                        let content = "";
                        if (articleEl) { content = articleEl.innerText; }
                        else if (mainEl) { content = mainEl.innerText; }
                        else if (document.body) { content = document.body.innerText; }
                        return content.replace(/\s+/g, " ").trim().substring(0, 4000);
                    }
                });
                if (results && results[0] && results[0].result) {
                    pageContent = results[0].result;
                }
            }
        } catch (e) {
            console.warn("Could not scrape tab content for auto-scan. Using URL only.", e);
        }

        // Calculate reading time
        let calculatedReadingTime = null;
        if (pageContent) {
            const wordCount = pageContent.split(/\s+/).length;
            calculatedReadingTime = Math.max(1, Math.ceil(wordCount / 200));
        }

        // 3. Prepare AI Prompt
        const AI_CAT_SCHEMA = {
            type: "object",
            properties: {
                category: {
                    type: "array",
                    items: { type: "string", enum: categories },
                    description: "An array of one or more relevant categories."
                },
                summary: { type: "string" }
            },
            required: ["category", "summary"]
        };

        const promptContext = `
              Analyze the following bookmark and classify it.
              Title: "${bookmark.title || "Untitled"}"
              URL: "${bookmark.url}"
              ${pageContent ? `The content of the page is:\n"""${pageContent}"""` : ""}
        `;
        const prompt = `
              ${promptContext}

              Task:
              1. Categorize precisely: Choose ONE or MORE of the most relevant categories from the provided enum list.
              2. Summarize effectively: Provide a highly concise, descriptive summary (1-2 sentences max) capturing the main topic or value proposition. Do not start with "This page is about".

              Your response MUST be a JSON object exactly matching the required schema.
        `;

        if (!self.LanguageModel) {
            console.warn("LanguageModel API not exposed in Background Worker.");
            return;
        }

        // 4. Run AI
        const session = await self.LanguageModel.create({
            systemPrompt: "You are an expert digital librarian and summarization AI. Your role is to accurately categorize bookmarks using a strict predefined taxonomy and to write high-quality, descriptive summaries. Focus on the core value and primary subject of the content, avoiding generic filler language.",
            expectedInputs: [{ type: "text", languages: ["en"] }],
            expectedOutputs: [{ type: "text", languages: ["en"] }]
        });

        const rawResponse = await session.prompt(prompt, { responseConstraint: AI_CAT_SCHEMA });
        session.destroy();

        const aiData = JSON.parse(rawResponse);

        // 5. Build cache object
        let cacheData;
        const categorySet = new Set(categories);
        
        if (aiData && aiData.summary && Array.isArray(aiData.category) && aiData.category.length > 0) {
            const validCategories = aiData.category.filter(cat => categorySet.has(cat));
            cacheData = {
                category: validCategories.length > 0 ? validCategories : ["Other"],
                summary: aiData.summary,
                isImportant: false,
                isViewed: false,
                readingTime: calculatedReadingTime
            };
        } else {
            cacheData = {
                category: ["Other"],
                summary: aiData.summary || "Unable to analyze link.",
                isImportant: false,
                isViewed: false,
                readingTime: calculatedReadingTime
            };
        }

        // 6. Save
        aiCache[bookmark.url] = cacheData;
        await chrome.storage.local.set({ [CACHE_KEY]: aiCache });

    } catch (e) {
        console.error("Background AI Scan failed:", e);
    }
});
