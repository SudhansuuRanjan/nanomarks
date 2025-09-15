const options = {
    sharedContext: 'This is a scientific article',
    type: 'key-points',
    format: 'markdown',
    length: 'medium',
    monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
            console.log(`Downloaded ${e.loaded * 100}%`);
        });
    }
};

const availability = await Summarizer.availability();
if (availability === 'unavailable') {
    // The Summarizer API isn't usable.
    return console.log('The Summarizer API is unavailable.');
}

// Check for user activation before creating the summarizer
if (navigator.userActivation.isActive) {
    const summarizer = await Summarizer.create(options);
    const longText = "With batch summarization, the model processes the input as a whole and then produces the output. To get a batch summary, call the summarize() function. The first argument is the text that you want to summarize. The second, optional argument is an object with a context field. This field lets you add background details that might improve the summarization."

    const summary = await summarizer.summarize(longText, {
        context: 'This article is intended for a tech-savvy audience.',
    });
}