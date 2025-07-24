// This script runs in the background of the Chrome extension
// It is the central place for all external API calls.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Use a single async function to handle all message types
    (async () => {
        try {
            if (request.type === 'generateTasks') {
                const { payload, apiKey } = request;
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
                
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const responseText = await response.text();
                if (!response.ok) {
                    console.error("Gemini API Error Response:", responseText);
                    throw new Error(`API returned status ${response.status}: ${responseText}`);
                }
                
                sendResponse({ success: true, data: JSON.parse(responseText) });

            } else if (request.type === 'mondayApiCall') {
                const { apiKey, query, variables } = request;
                const MONDAY_API_URL = 'https://api.monday.com/v2';

                const response = await fetch(MONDAY_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': apiKey,
                        'API-Version': '2023-10'
                    },
                    body: JSON.stringify({ query, variables }),
                });

                const responseText = await response.text(); // Read the body ONCE as text
                if (!response.ok) {
                     console.error("Monday API Error Response:", responseText);
                    throw new Error(`API returned status ${response.status}: ${responseText}`);
                }
                
                const result = JSON.parse(responseText); // Parse the text we already read
                if (result.errors) {
                    throw new Error(`Monday API Error: ${result.errors[0].message}`);
                }
                
                sendResponse({ success: true, data: result.data });
            }
        } catch (error) {
            console.error('Background script error:', error.message);
            sendResponse({ success: false, error: error.message });
        }
    })();

    // Return true to indicate that we will send a response asynchronously.
    return true;
});