/* global chrome */
import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- BOARD IDs ---
const BOARD_IDS = {
    COMPANIES: 8123809226,
    PROPOSALS: 8123809240,
    DEALS: 8123809253,
    INITIATIVES: 8575110795,
    TASKS: 8575873550,
};

// --- Helper Components ---
const Icon = ({ path }) => (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{width: '1.5rem', height: '1.5rem'}}><path d={path} /></svg>);
const BrainIcon = () => <Icon path="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L8 12v1c0 1.1.9 2 2 2v1.93zm6.85-2.57c-.64.64-1.49 1.1-2.42 1.34V18c0-1.1-.9-2-2-2v-1l1.79-1.79c.13-.13.21-.3.21-.47V12h-2v-.17c0-.28-.11-.55-.3-.74L8.41 9.3c-.13-.13-.21-.3-.21-.47V8h2c1.1 0 2-.9 2-2V5.07c3.95.49 7 3.85 7 7.93 0 1.57-.46 3.03-1.26 4.28l-.11.17z" />;
const SyncIcon = ({ isSyncing }) => <div style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }}><Icon path="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" /></div>;
const UploadIcon = () => <Icon path="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" />;
const Spinner = () => (<div style={{animation: 'spin 1s linear infinite', borderRadius: '9999px', height: '1.5rem', width: '1.5rem', borderBottom: '2px solid white'}}></div>);

// --- Main App Component ---
export default function App() {
    const [mondayApiKey, setMondayApiKey] = useState('');
    const [geminiApiKey, setGeminiApiKey] = useState('');
    const [userInput, setUserInput] = useState('');
    const [imageFile, setImageFile] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [boardContext, setBoardContext] = useState(null);
    const [lastSyncTime, setLastSyncTime] = useState(null);
    const [taskBoardOptions, setTaskBoardOptions] = useState({ status: [], priority: [] });
    const [proposedTasks, setProposedTasks] = useState([]);
    const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });
    const [isDragging, setIsDragging] = useState(false);

    const handleSyncContext = useCallback((isBackground = false) => {
        if (!mondayApiKey) {
            if (!isBackground) setStatusMessage({ type: 'error', text: 'Please enter and save your monday.com API Key.' });
            return;
        }
        setIsSyncing(true);
        if (!isBackground) setStatusMessage({ type: '', text: '' });
        
        const idsToSync = Object.values(BOARD_IDS);
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
                    columns {
                        id
                        title
                        settings_str
                    }
                }
            }`;

        chrome.runtime.sendMessage({ type: 'mondayApiCall', apiKey: mondayApiKey, query, variables: { boardIds: idsToSync } }, (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
                const errorMsg = response?.error || chrome.runtime.lastError?.message || "Unknown error during sync.";
                if (!isBackground) setStatusMessage({ type: 'error', text: `Sync failed: ${errorMsg}` });
                setIsSyncing(false);
                return;
            }

            try {
                const { boards } = response.data;
                const getBoard = (id) => boards.find(b => b.id === id);

                const companiesBoard = getBoard(BOARD_IDS.COMPANIES);
                const tasksBoard = getBoard(BOARD_IDS.TASKS);

                let context = "BUSINESS CONTEXT:\n";
                const companyItems = companiesBoard?.items_page?.items || [];
                const allCompanies = companyItems.map(item => {
                    const codeCol = item.column_values.find(c => c.id === 'text_mkkk3hmx');
                    return { name: item.name, code: codeCol?.text || 'N/A' };
                });
                
                context += "--- ALL COMPANIES (Source of Truth) ---\n" + allCompanies.map(c => `${c.name} (Code: ${c.code})`).join('\n') + "\n\n";
                setBoardContext(context);
                
                if (tasksBoard && tasksBoard.columns) {
                    const options = { status: [], priority: [] };
                    const statusCol = tasksBoard.columns.find(c => c.id === 'status');
                    const priorityCol = tasksBoard.columns.find(c => c.id === 'priority');
                    if (statusCol?.settings_str) { try { options.status = Object.values(JSON.parse(statusCol.settings_str).labels); } catch (e) {} }
                    if (priorityCol?.settings_str) { try { options.priority = Object.values(JSON.parse(priorityCol.settings_str).labels); } catch (e) {} }
                    setTaskBoardOptions(options);
                }

                setLastSyncTime(new Date());
                if (!isBackground) setStatusMessage({ type: 'success', text: 'Business context synced successfully!' });
            } catch (e) {
                if (!isBackground) setStatusMessage({ type: 'error', text: 'Error processing synced data.' });
            } finally {
                setIsSyncing(false);
            }
        });
    }, [mondayApiKey]);

    useEffect(() => {
        if (window.chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['geminiApiKey', 'mondayApiKey'], (result) => {
                if (result.geminiApiKey) setGeminiApiKey(result.geminiApiKey);
                if (result.mondayApiKey) setMondayApiKey(result.mondayApiKey);
            });
        }
    }, []);

    useEffect(() => {
        if (mondayApiKey) {
            handleSyncContext(true);
            const intervalId = setInterval(() => handleSyncContext(true), 300000);
            return () => clearInterval(intervalId);
        }
    }, [mondayApiKey, handleSyncContext]);

    const handleSaveSettings = () => {
        if (window.chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ geminiApiKey, mondayApiKey }, () => {
                setStatusMessage({ type: 'success', text: 'Settings saved!' });
                handleSyncContext(false);
            });
        }
    };

    const handleGenerateTask = async () => {
        if (!geminiApiKey) { setStatusMessage({ type: 'error', text: 'Please add your Google AI API Key.' }); return; }
        if (!userInput && !imageFile) { return; }
        setIsLoading(true); setProposedTasks([]);
        
        const mainPrompt = `You are an expert AI task processor. Your only job is to analyze a user's request, find a matching company from the provided context, and create a prefixed task name.

            ${boardContext || "No business context available."}

            **YOUR TASK IS TO FIND THE CORRECT PREFIX. FOLLOW THESE STEPS:**

            **Step 1: Search for a Company in the User's Request.**
            - Read the user's request carefully.
            - Scour the "ALL COMPANIES" list from the context to find a matching company name. This is your highest priority.
            - Your matching MUST be flexible: ignore case and minor typos (e.g., "skidrow studio" should match "Skidrow Studios").

            **Step 2: Assign a Prefix based on the Search Result.**
            - **A) If a matching company IS FOUND in the "ALL COMPANIES" list:**
                - You MUST extract its corresponding code from the context.
                - If the code is valid and not 'N/A', THAT CODE is your prefix.
                - If the found company's code is 'N/A', use NO prefix.
            
            - **B) If NO matching company IS FOUND after searching the entire list:**
                - The task is internal. Assign an internal prefix.
                - Use \`SYS\` for systems, IT, or automations.
                - Use \`OPS\` for internal operations or processes.
                - Use \`BIZDEV\` for general sales or business development activities that do not mention any company.
            
            - **C) If NO prefix applies after all checks, use NO prefix.**

            **CRITICAL RULE:** You are forbidden from inventing, guessing, or creating a client code from a name. Your only job is to find the pre-existing code from the context.

            **Step 3: Format the Final JSON Output.**
            - Your output **MUST** be a JSON object: \`{ "tasks": [ { "task_name": "string", "description": "string", "status": "string", "priority": "string" } ] }\`
            - For \`task_name\`, combine the prefix and " > " with the user's original text. Example: "CODE > build catalog for some company".
            - For \`description\`, use the user's original text.
            - For \`status\` and \`priority\`, suggest one of these valid options if possible: ${JSON.stringify(taskBoardOptions)}. Default to "Needs Action" and "Medium".

            Analyze the user's request and provide the JSON.`;

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

    const handleApproveTask = (taskToApprove) => {
        setStatusMessage({ type: '', text: `Approving "${taskToApprove.task_name}"...` });
        
        const column_values = {
            'status': { label: taskToApprove.status || "Needs Action" },
            'priority': { label: taskToApprove.priority || "Medium" },
        };
        const createItemQuery = `mutation ($item_name: String!, $board_id: ID!, $column_values: JSON) { create_item (board_id: $board_id, item_name: $item_name, column_values: $column_values) { id } }`;
        const createVariables = {
            board_id: BOARD_IDS.TASKS,
            item_name: taskToApprove.task_name,
            column_values: JSON.stringify(column_values),
        };
        
        chrome.runtime.sendMessage({ type: 'mondayApiCall', apiKey: mondayApiKey, query: createItemQuery, variables: createVariables }, (createResponse) => {
            if (!createResponse?.success) {
                setStatusMessage({ type: 'error', text: `Failed to create task. ${createResponse?.error}` });
                return;
            }
            const newItemId = createResponse.data.create_item.id;
            if (taskToApprove.description && taskToApprove.description.trim() !== '') {
                const updateQuery = `mutation ($item_id: ID!, $body: String!) { create_update (item_id: $item_id, body: $body) { id } }`;
                const updateVariables = { item_id: newItemId, body: taskToApprove.description };
                chrome.runtime.sendMessage({ type: 'mondayApiCall', apiKey: mondayApiKey, query: updateQuery, variables: updateVariables }, (updateResponse) => {
                    if (!updateResponse?.success) {
                        setStatusMessage({ type: 'error', text: `Task created, but failed to add update: ${updateResponse?.error}` });
                    } else {
                        setStatusMessage({ type: 'success', text: `Task "${taskToApprove.task_name}" created with update!` });
                    }
                    setProposedTasks(prev => prev.filter(p => p.id !== taskToApprove.id));
                    handleSyncContext(true);
                });
            } else {
                setStatusMessage({ type: 'success', text: `Task "${taskToApprove.task_name}" created!` });
                setProposedTasks(prev => prev.filter(p => p.id !== taskToApprove.id));
                handleSyncContext(true);
            }
        });
    };
    
    // --- Helper functions & Event Handlers ---
    const fileToBase64 = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; });
    const handleClear = () => { setUserInput(''); setImageFile(null); setImagePreview(null); setProposedTasks([]); setStatusMessage({ type: '', text: '' }); };
    const handleFileChange = (e) => { const file = e.target.files?.[0]; if (file?.type.startsWith('image/')) { setImageFile(file); const reader = new FileReader(); reader.onloadend = () => setImagePreview(reader.result); reader.readAsDataURL(file); } };
    const handleTaskChange = (taskId, field, value) => { setProposedTasks(prevTasks => prevTasks.map(task => task.id === taskId ? { ...task, [field]: value } : task)); };
    const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
    const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
    const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
    const handleDrop = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; if (file?.type.startsWith('image/')) { setImageFile(file); const reader = new FileReader(); reader.onloadend = () => setImagePreview(reader.result); reader.readAsDataURL(file); e.dataTransfer.clearData(); }};
    const handleRemoveImage = () => { setImageFile(null); setImagePreview(null); const fileInput = document.getElementById('file-upload'); if (fileInput) fileInput.value = ''; };

    const styles = { appContainer: { backgroundColor: '#111827', color: 'white', fontFamily: 'sans-serif', padding: '1rem', boxSizing: 'border-box', height: '100%', display: 'flex', flexDirection: 'column' }, header: { textAlign: 'center', marginBottom: '1rem', flexShrink: 0 }, title: { fontSize: '1.75rem', fontWeight: 'bold', background: 'linear-gradient(to right, #a78bfa, #22d3ee)', WebkitBackgroundClip: 'text', color: 'transparent', marginBottom: '0.25rem' }, subtitle: { color: '#9ca3af', fontSize: '0.875rem' }, statusMessage: (type) => ({ padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem', textAlign: 'center', backgroundColor: type === 'success' ? 'rgba(74, 222, 128, 0.2)' : 'rgba(239, 68, 68, 0.2)', color: type === 'success' ? '#86efac' : '#f87171' }), grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', flex: 1, minHeight: 0 }, card: { backgroundColor: 'rgba(31, 41, 55, 0.5)', padding: '1rem', borderRadius: '1rem', border: '1px solid #374151', display: 'flex', flexDirection: 'column', gap: '1rem', transition: 'border-color 0.2s', overflowY: 'auto' }, cardDragging: { borderColor: '#a78bfa' }, settingsSummary: { fontSize: '1.125rem', fontWeight: '600', cursor: 'pointer', color: '#d1d5db' }, settingsDetails: { marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', borderTop: '1px solid #374151', paddingTop: '1rem' }, label: { display: 'block', fontSize: '0.75rem', fontWeight: '500', color: '#9ca3af', marginBottom: '0.25rem' }, input: { width: '100%', backgroundColor: '#111827', border: '1px solid #4b5563', borderRadius: '0.375rem', padding: '0.5rem', boxSizing: 'border-box', color: 'white' }, textarea: { width: '100%', backgroundColor: '#111827', border: '1px solid #4b5563', borderRadius: '0.375rem', padding: '0.75rem', height: '7rem', boxSizing: 'border-box', color: 'white' }, button: { width: '100%', fontWeight: 'bold', padding: '0.75rem 1rem', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', cursor: 'pointer', border: 'none' }, placeholder: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280', textAlign: 'center', padding: '2rem', border: '2px dashed #374151', borderRadius: '0.5rem' }, taskCard: { backgroundColor: 'rgba(55, 65, 81, 0.5)', padding: '1rem', borderRadius: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }, editableInput: { width: '100%', backgroundColor: 'rgba(17, 24, 39, 0.8)', border: '1px solid #4b5563', borderRadius: '0.375rem', padding: '0.5rem', boxSizing: 'border-box', color: 'white', fontWeight: 'bold', fontSize: '1rem' }, editableTextarea: { width: '100%', backgroundColor: 'rgba(17, 24, 39, 0.8)', border: '1px solid #4b5563', borderRadius: '0.375rem', padding: '0.5rem', boxSizing: 'border-box', color: '#d1d5db', height: '4rem', fontSize: '0.875rem' }, imagePreviewContainer: { position: 'relative', marginTop: '1rem' }, removeImageButton: { position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: '1.5rem', height: '1.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', lineHeight: '1rem' }};

    // --- RENDER ---
    return (
        <div style={styles.appContainer}>
            <header style={styles.header}><h1 style={styles.title}>Autonomous AI Assistant</h1><p style={styles.subtitle}>Your intelligent gateway to monday.com</p></header>
            {statusMessage.text && (<div style={styles.statusMessage(statusMessage.type)}>{statusMessage.text}</div>)}
            <div style={styles.grid}>
                <div style={{...styles.card, ...(isDragging ? styles.cardDragging : {})}} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDrop={handleDrop}>
                    <div style={{display: 'flex', alignItems: 'flex-start', gap: '1rem'}}>
                        <details style={{flex: 1}}>
                            <summary style={styles.settingsSummary}>Settings</summary>
                            <div style={styles.settingsDetails}>
                                <div><label style={styles.label}>monday.com API Key</label><input type="password" value={mondayApiKey} onChange={e => setMondayApiKey(e.target.value)} style={styles.input} placeholder="Enter your monday.com key" /></div>
                                <div><label style={styles.label}>Google AI API Key</label><input type="password" value={geminiApiKey} onChange={e => setGeminiApiKey(e.target.value)} style={styles.input} placeholder="Enter your Google AI key" /></div>
                                <button onClick={handleSaveSettings} style={{...styles.button, backgroundColor: '#8b5cf6', color: 'white'}}>Save Settings</button>
                            </div>
                        </details>
                        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                            <button onClick={() => handleSyncContext(false)} disabled={isSyncing} style={{...styles.button, backgroundColor: '#06b6d4', padding: '0.5rem 1rem', color: 'white'}}>
                                <SyncIcon isSyncing={isSyncing} />
                                <span style={{marginLeft: '0.5rem'}}>Sync Now</span>
                            </button>
                            {lastSyncTime && <p style={{fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem', textAlign: 'center'}}>Synced: {lastSyncTime.toLocaleTimeString()}</p>}
                        </div>
                    </div>
                    <div><h2 style={{fontSize: '1.125rem', fontWeight: '600', color: '#d1d5db', marginBottom: '0.75rem'}}>1. Provide Input</h2><textarea value={userInput} onChange={e => setUserInput(e.target.value)} style={styles.textarea} placeholder="Describe a task, paste a transcript, or drag an image..."/></div>
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem'}}>
                        <label htmlFor="file-upload" style={{...styles.button, flex: 1, backgroundColor: '#374151', color: '#d1d5db'}}><UploadIcon /><span>{imageFile ? "Image Added" : "Add Image"}</span></label>
                        <input id="file-upload" type="file" style={{display: 'none'}} onChange={handleFileChange} accept="image/*" />
                    </div>
                    {imagePreview && (<div style={styles.imagePreviewContainer}><img src={imagePreview} alt="Preview" style={{borderRadius: '0.5rem', maxHeight: '10rem', width: '100%', objectFit: 'contain'}} /><button onClick={handleRemoveImage} style={styles.removeImageButton}>&times;</button></div>)}
                    <button onClick={handleGenerateTask} disabled={isLoading || !mondayApiKey || !geminiApiKey} style={{...styles.button, background: 'linear-gradient(to right, #8b5cf6, #22d3ee)', color: 'white', marginTop: 'auto'}}>{isLoading ? <Spinner /> : <BrainIcon />}<span>Generate Tasks</span></button>
                </div>
                <div style={styles.card}>
                    <h2 style={{fontSize: '1.125rem', fontWeight: '600', color: '#d1d5db', marginBottom: '0.75rem'}}>2. Validate & Create Tasks</h2>
                    {isLoading ? (<div style={styles.placeholder}><Spinner /><p style={{marginTop: '1rem'}}>AI is analyzing...</p></div>) : proposedTasks.length === 0 ? (<div style={styles.placeholder}><BrainIcon /><p style={{marginTop: '0.5rem'}}>Proposed tasks will appear here.</p></div>) : (
                        <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                            {proposedTasks.map((task) => (
                                <div key={task.id} style={styles.taskCard}>
                                    <input type="text" value={task.task_name} onChange={(e) => handleTaskChange(task.id, 'task_name', e.target.value)} style={styles.editableInput} />
                                    <textarea placeholder="Add a description... (this will be an update)" value={task.description || ''} onChange={(e) => handleTaskChange(task.id, 'description', e.target.value)} style={styles.editableTextarea} />
                                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem'}}>
                                        <div><label style={{...styles.label}}>Status</label><select style={{...styles.input, padding: '0.25rem', fontSize: '0.75rem'}} value={task.status} onChange={(e) => handleTaskChange(task.id, 'status', e.target.value)}>{taskBoardOptions.status.map(label => (<option key={label} value={label}>{label}</option>))}</select></div>
                                        <div><label style={{...styles.label}}>Priority</label><select style={{...styles.input, padding: '0.25rem', fontSize: '0.75rem'}} value={task.priority} onChange={(e) => handleTaskChange(task.id, 'priority', e.target.value)}>{taskBoardOptions.priority.map(label => (<option key={label} value={label}>{label}</option>))}</select></div>
                                    </div>
                                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem'}}><button onClick={() => handleApproveTask(task)} style={{...styles.button, flex: 1, backgroundColor: '#16a34a', color: 'white'}}>Approve</button><button onClick={() => setProposedTasks(p => p.filter(t => t.id !== task.id))} style={{...styles.button, flex: 1, backgroundColor: '#dc2626', color: 'white'}}>Remove</button></div>
                                </div>
                            ))}
                            <button onClick={handleClear} style={{...styles.button, backgroundColor: '#4b5563', color: 'white', marginTop: '1rem'}}>Clear All</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}