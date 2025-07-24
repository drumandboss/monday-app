/* global chrome */
import React, { useState, useEffect, useCallback } from 'react';

// --- BOARD IDs ---
const BOARD_IDS = {
    COMPANIES: 8123809226,
    PROPOSALS: 8123809240,
    DEALS: 8123809253,
    INITIATIVES: 8575110795,
    TASKS: 8575873550,
};

export default function App() {
    const [mondayApiKey, setMondayApiKey] = useState('');
    const [geminiApiKey, setGeminiApiKey] = useState('');
    const [userInput, setUserInput] = useState('');
    const [imageFile, setImageFile] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [companiesContext, setCompaniesContext] = useState([]);
    const [lastSyncTime, setLastSyncTime] = useState(null);
    const [proposedTasks, setProposedTasks] = useState([]);
    const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });
    const [showSettings, setShowSettings] = useState(false);
    const [showCompanies, setShowCompanies] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    // --- SYNC MONDAY.COM CONTEXT ---
    const handleSyncContext = useCallback(() => {
        if (!mondayApiKey) {
            setStatusMessage({ type: 'error', text: 'Please enter your monday.com API Key.' });
            return;
        }
        setIsSyncing(true);
        setStatusMessage({ type: '', text: '' });

        const query = `
        query SyncBoards($boardIds: [ID!]) {
            boards(ids: $boardIds) {
                id
                name
                items_page(limit: 500) {
                    items {
                        id
                        name
                        column_values(ids: ["text_mkkk3hmx"]) {
                            id
                            text
                        }
                    }
                }
            }
        }`;

        chrome.runtime.sendMessage({ type: 'mondayApiCall', apiKey: mondayApiKey, query, variables: { boardIds: [BOARD_IDS.COMPANIES] } }, (response) => {
            setIsSyncing(false);
            if (!response?.success) {
                setStatusMessage({ type: 'error', text: 'Failed to sync companies: ' + (response?.error || 'Unknown error') });
                setCompaniesContext([]);
                return;
            }
            try {
                const board = response.data.boards[0];
                const items = board?.items_page?.items || [];
                const companies = items.map(item => ({
                    name: item.name,
                    code: item.column_values[0]?.text?.toUpperCase?.() || '',
                })).filter(c => c.name && c.code);
                setCompaniesContext(companies);
                setLastSyncTime(new Date());
                setStatusMessage({ type: 'success', text: 'Companies loaded successfully!' });
            } catch (e) {
                setCompaniesContext([]);
                setStatusMessage({ type: 'error', text: 'Error processing companies.' });
            }
        });
    }, [mondayApiKey]);

    // --- ON LOAD, LOAD API KEYS AND CONTEXT ---
    useEffect(() => {
        if (window.chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['geminiApiKey', 'mondayApiKey'], (result) => {
                if (result.geminiApiKey) setGeminiApiKey(result.geminiApiKey);
                if (result.mondayApiKey) setMondayApiKey(result.mondayApiKey);
            });
        }
    }, []);
    useEffect(() => {
        if (mondayApiKey) handleSyncContext();
        // eslint-disable-next-line
    }, [mondayApiKey]);

    // --- SAVE SETTINGS ---
    const handleSaveSettings = () => {
        if (window.chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ geminiApiKey, mondayApiKey }, () => {
                setStatusMessage({ type: 'success', text: 'Settings saved!' });
                handleSyncContext();
            });
        }
    };

    // --- GENERATE TASKS ---
    const handleGenerateTask = async () => {
        if (!geminiApiKey) { setStatusMessage({ type: 'error', text: 'Please add your Google AI API Key.' }); return; }
        if (!userInput && !imageFile) { return; }
        setIsLoading(true); setProposedTasks([]);

        // All companies string for the prompt
        const allCompaniesString = companiesContext.length > 0
            ? companiesContext.map(c => `${c.name} (Code: ${c.code})`).join('\n')
            : 'No companies loaded!';

        // Main Prompt
        const mainPrompt = `
You are an AI assistant for a digital agency using monday.com.
Your job is to analyze a user’s request (text and/or screenshot) and determine the correct client company from the provided business context.

**IMPORTANT:** If any part of a company name in the ALL COMPANIES list appears in the user request (even partially), use that company's official code. Do not abbreviate, do not invent codes. Match case-insensitive, partial names, and typos.

ALL COMPANIES (always up to date): 
${allCompaniesString}

Instructions:
1. If an image is provided, perform OCR and extract visible text (especially any company or sender names).
2. Search for a client/company name in the user’s request or screenshot, using the ALL COMPANIES list above (case/typo tolerant, partial match allowed).
   - If a match is found, extract the official code (from above) and use it as a prefix in the task name.
   - Never invent codes. Use only codes from the list.
3. If no match, use:
   - SYS for system/internal/automation
   - OPS for general agency ops
   - BIZDEV for business development tasks with no client mentioned
4. Never use "OPS" if the text appears to be from a client or about a client.
5. Summarize the core need in a clear task title. The description should be a concise summary, not just a copy-paste.
6. Output: JSON like {"tasks": [ { "task_name": "CODE > short task summary", "description": "short, clear explanation or question for the team", "status": "Needs Action", "priority": "Medium" } ]}
---
User Input: ${userInput ? `Text: "${userInput}"` : ""}
${imageFile ? "Image: provided (run OCR and extract company name if present)" : ""}
`;

        try {
            const userParts = [{ text: mainPrompt }];
            if (userInput) userParts.push({ text: `User Request Text: "${userInput}"` });
            if (imageFile) {
                const base64ImageData = await fileToBase64(imageFile);
                userParts.push({ text: "User Request Image:" }, { inlineData: { mimeType: imageFile.type, data: base64ImageData } });
            }
            const payload = { contents: [{ role: "user", parts: userParts }], generationConfig: { responseMimeType: "application/json" } };

            chrome.runtime.sendMessage({ type: 'generateTasks', payload, apiKey: geminiApiKey }, (response) => {
                setIsLoading(false);
                if (!response?.success) {
                    setStatusMessage({ type: 'error', text: `AI Error: ${response?.error || 'No response.'}` });
                    return;
                }
                const rawText = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!rawText) {
                    setStatusMessage({ type: 'error', text: 'AI returned an empty proposal.' });
                    return;
                }
                try {
                    const jsonString = rawText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                    const result = JSON.parse(jsonString);
                    if (result?.tasks?.length > 0) {
                        setProposedTasks(result.tasks.map(task => ({ ...task, id: crypto.randomUUID() })));
                    } else {
                        setStatusMessage({ type: 'error', text: 'AI could not identify any tasks.' });
                    }
                } catch (e) {
                    setStatusMessage({ type: 'error', text: 'Failed to parse AI response.' });
                }
            });
        } catch (error) {
            setIsLoading(false);
            setStatusMessage({ type: 'error', text: `Error: ${error.message}` });
        }
    };

    // --- SEND TASK TO MONDAY.COM ---
    const handleApproveTask = (task) => {
        setStatusMessage({ type: '', text: `Approving "${task.task_name}"...` });

        // Build column values (expand as needed)
        const column_values = {
            'status': { label: task.status || "Needs Action" },
            'priority': { label: task.priority || "Medium" },
        };
        const createItemQuery = `
            mutation ($item_name: String!, $board_id: ID!, $column_values: JSON) {
                create_item (board_id: $board_id, item_name: $item_name, column_values: $column_values) { id }
            }`;
        const createVariables = {
            board_id: BOARD_IDS.TASKS,
            item_name: task.task_name,
            column_values: JSON.stringify(column_values),
        };

        chrome.runtime.sendMessage(
            { type: 'mondayApiCall', apiKey: mondayApiKey, query: createItemQuery, variables: createVariables },
            (createResponse) => {
                if (!createResponse?.success) {
                    setStatusMessage({ type: 'error', text: `Failed to create task. ${createResponse?.error}` });
                    return;
                }
                const newItemId = createResponse.data.create_item.id;
                if (task.description && task.description.trim() !== '') {
                    const updateQuery = `
                        mutation ($item_id: ID!, $body: String!) {
                            create_update (item_id: $item_id, body: $body) { id }
                        }`;
                    const updateVariables = { item_id: newItemId, body: task.description };
                    chrome.runtime.sendMessage(
                        { type: 'mondayApiCall', apiKey: mondayApiKey, query: updateQuery, variables: updateVariables },
                        (updateResponse) => {
                            if (!updateResponse?.success) {
                                setStatusMessage({ type: 'error', text: `Task created, but failed to add update: ${updateResponse?.error}` });
                            } else {
                                setStatusMessage({ type: 'success', text: `Task "${task.task_name}" created with update!` });
                            }
                            setProposedTasks(prev => prev.filter(p => p.id !== task.id));
                            handleSyncContext(true); // refresh context if you want
                        }
                    );
                } else {
                    setStatusMessage({ type: 'success', text: `Task "${task.task_name}" created!` });
                    setProposedTasks(prev => prev.filter(p => p.id !== task.id));
                    handleSyncContext(true);
                }
            }
        );
    };

    // --- Drag & Drop Handlers ---
    const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file?.type.startsWith('image/')) {
            setImageFile(file);
            const reader = new FileReader();
            reader.onloadend = () => setImagePreview(reader.result);
            reader.readAsDataURL(file);
        }
    };

    // --- Helper: File to Base64 ---
    const fileToBase64 = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; });

    // --- RENDER ---
    return (
        <div style={{ background: '#101927', minHeight: '100vh', color: 'white', fontFamily: 'sans-serif', padding: 32 }}>
            <h1 style={{ fontWeight: 700, fontSize: '2.3rem', background: 'linear-gradient(90deg,#a78bfa,#22d3ee)', WebkitBackgroundClip: 'text', color: 'transparent' }}>Autonomous AI Assistant</h1>
            <div style={{ color: '#a5b4fc', marginBottom: 16 }}>Your intelligent gateway to monday.com</div>

            <details open={showSettings} style={{ marginBottom: 12 }} onToggle={e => setShowSettings(e.target.open)}>
                <summary style={{ fontWeight: 700, fontSize: '1.3rem', cursor: 'pointer' }}>Settings</summary>
                <div style={{ margin: '12px 0' }}>
                    <label style={{ fontSize: 13 }}>Monday.com API Key</label>
                    <input type="password" value={mondayApiKey} onChange={e => setMondayApiKey(e.target.value)} style={{ width: '100%', background: '#181f2e', color: '#a5b4fc', borderRadius: 6, border: '1px solid #444', marginBottom: 8, padding: 7, fontSize: 14 }} />
                    <label style={{ fontSize: 13 }}>Google AI API Key</label>
                    <input type="password" value={geminiApiKey} onChange={e => setGeminiApiKey(e.target.value)} style={{ width: '100%', background: '#181f2e', color: '#a5b4fc', borderRadius: 6, border: '1px solid #444', marginBottom: 8, padding: 7, fontSize: 14 }} />
                    <button onClick={handleSaveSettings} style={{ padding: '8px 24px', background: '#a78bfa', color: '#222', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 16, marginTop: 4 }}>Save Settings</button>
                    {lastSyncTime && <div style={{ color: '#67e8f9', fontSize: 12, marginTop: 4 }}>Synced: {lastSyncTime.toLocaleTimeString()}</div>}
                </div>
            </details>

            {statusMessage.text && (
                <div style={{
                    padding: 12, borderRadius: 7, margin: '16px 0', fontWeight: 500, background: statusMessage.type === 'success' ? '#164e3b' : '#7f1d1d', color: statusMessage.type === 'success' ? '#4ade80' : '#f87171'
                }}>{statusMessage.text}</div>
            )}

            <details open={showCompanies} style={{ marginBottom: 18 }} onToggle={e => setShowCompanies(e.target.open)}>
                <summary style={{ fontWeight: 700, fontSize: '1.15rem', color: '#c4b5fd', cursor: 'pointer' }}>Companies loaded from Monday (the AI sees these)</summary>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {companiesContext.map(c => <li key={c.code}><b>{c.name}</b> <span style={{ color: '#6ee7b7' }}>({c.code})</span></li>)}
                </ul>
                {companiesContext.length === 0 && <div style={{ color: '#f87171' }}>No companies loaded! Check your API key or sync again.</div>}
            </details>

            {/* Input/Task Panels */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div
                    style={{
                        background: '#181f2e',
                        borderRadius: 10,
                        padding: 20,
                        border: isDragging ? '2px dashed #a78bfa' : 'none',
                        transition: 'border .2s'
                    }}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 7 }}>1. Provide Input</div>
                    <textarea
                        value={userInput}
                        onChange={e => setUserInput(e.target.value)}
                        style={{
                            width: '100%',
                            background: '#222b3b',
                            border: '1px solid #222',
                            color: '#b8c1ec',
                            padding: 12,
                            borderRadius: 7,
                            fontSize: 15,
                            minHeight: 100
                        }}
                        placeholder="Describe a task, paste a transcript, or drag an image..."
                    />
                    <div style={{ margin: '12px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <label htmlFor="file-upload" style={{ background: '#313a54', color: '#b8c1ec', padding: '8px 16px', borderRadius: 7, cursor: 'pointer' }}>{imageFile ? "Image Added" : "Add Image"}</label>
                        <input id="file-upload" type="file" style={{ display: 'none' }} onChange={e => {
                            const file = e.target.files?.[0];
                            if (file?.type.startsWith('image/')) {
                                setImageFile(file);
                                const reader = new FileReader();
                                reader.onloadend = () => setImagePreview(reader.result);
                                reader.readAsDataURL(file);
                            }
                        }} accept="image/*" />
                        {imagePreview && <button onClick={() => { setImageFile(null); setImagePreview(null); }} style={{ marginLeft: 8, background: '#991b1b', color: '#fff', borderRadius: 7, border: 'none', padding: '6px 12px', cursor: 'pointer' }}>Remove</button>}
                        <span style={{ color: '#9ca3af', fontSize: 13, marginLeft: 'auto' }}>{isDragging ? "Drop your image here..." : "You can also drag & drop an image"}</span>
                    </div>
                    {imagePreview && <img src={imagePreview} alt="Preview" style={{ borderRadius: 7, maxHeight: 120, width: '100%', objectFit: 'contain', marginBottom: 12 }} />}
                    <button onClick={handleGenerateTask} disabled={isLoading || !mondayApiKey || !geminiApiKey} style={{ width: '100%', background: 'linear-gradient(to right, #a78bfa, #22d3ee)', color: '#222', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 17, padding: '13px 0', marginTop: 8 }}>{isLoading ? 'Thinking...' : 'Generate Tasks'}</button>
                </div>
                <div style={{ background: '#181f2e', borderRadius: 10, padding: 20 }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 7 }}>2. Validate & Create Tasks</div>
                    {isLoading ? (
                        <div style={{ color: '#a5b4fc', fontWeight: 500, textAlign: 'center', margin: 28 }}>AI is analyzing...</div>
                    ) : proposedTasks.length === 0 ? (
                        <div style={{ color: '#475569', fontWeight: 500, textAlign: 'center', margin: 28 }}>Proposed tasks will appear here.</div>
                    ) : (
                        <div>
                            {proposedTasks.map((task) => (
                                <div key={task.id} style={{ background: '#222b3b', borderRadius: 7, padding: 13, marginBottom: 14 }}>
                                    <input type="text" value={task.task_name} readOnly style={{ width: '100%', background: 'rgba(17,24,39,0.8)', color: '#facc15', fontWeight: 700, border: '1px solid #444', borderRadius: 5, padding: 7, fontSize: 16, marginBottom: 6 }} />
                                    <textarea value={task.description || ''} readOnly style={{ width: '100%', background: 'rgba(17,24,39,0.8)', color: '#e0e7ef', border: '1px solid #333', borderRadius: 5, padding: 7, fontSize: 14, minHeight: 48 }} />
                                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                        <button onClick={() => handleApproveTask(task)} style={{ flex: 1, background: '#16a34a', color: 'white', border: 'none', borderRadius: 6, padding: '10px 0', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>Approve</button>
                                        <button onClick={() => setProposedTasks(prev => prev.filter(p => p.id !== task.id))} style={{ flex: 1, background: '#dc2626', color: 'white', border: 'none', borderRadius: 6, padding: '10px 0', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>Remove</button>
                                    </div>
                                </div>
                            ))}
                            <button onClick={() => setProposedTasks([])} style={{ width: '100%', background: '#374151', color: 'white', border: 'none', borderRadius: 8, padding: '11px 0', fontWeight: 700, marginTop: 14 }}>Clear All</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
