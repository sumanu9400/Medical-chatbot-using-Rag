// MedAI - Medical AI Assistant Frontend
// Real-time streaming, markdown rendering, sidebar, timestamps

// ========== DOM Elements ==========
const chatContainer = document.getElementById('chatContainer');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const charCount = document.getElementById('charCount');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.getElementById('sidebar');
const welcomeSection = document.getElementById('welcomeSection');

// ========== Configure marked.js ==========
if (typeof marked !== 'undefined') {
    marked.setOptions({
        breaks: true,
        gfm: true,
        sanitize: false
    });
}

// ========== State ==========
let isProcessing = false;
let sidebarOpen = true;

// ========== Init ==========
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    adjustTextareaHeight();
    userInput.focus();
    checkHealth();
});

// ========== Health Check ==========
async function checkHealth() {
    try {
        const res = await fetch('/api/health');
        const data = await res.json();
        if (data.status !== 'ok' || data.llm !== 'ready') {
            setStatus('Service issue — check API key', false);
        }
    } catch (e) {
        setStatus('Cannot connect to server', false);
    }
}

function setStatus(text, ready = true) {
    statusText.textContent = text;
    statusDot.className = 'status-dot' + (ready ? '' : ' thinking');
}

// ========== Event Listeners ==========
function setupEventListeners() {
    sendBtn.addEventListener('click', handleSend);
    clearBtn.addEventListener('click', handleClear);

    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    userInput.addEventListener('input', () => {
        adjustTextareaHeight();
        updateCharCount();
    });

    sidebarToggle.addEventListener('click', toggleSidebar);

    // Quick chips
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const query = chip.dataset.query;
            userInput.value = query;
            adjustTextareaHeight();
            updateCharCount();
            userInput.focus();
            handleSend();
            // On mobile, close sidebar after chip click
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
                sidebarOpen = false;
            }
        });
    });

    // Close sidebar on overlay click (mobile)
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && sidebarOpen) {
            if (!sidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
                sidebar.classList.remove('open');
                sidebarOpen = false;
            }
        }
    });
}

// ========== Sidebar Toggle ==========
function toggleSidebar() {
    if (window.innerWidth <= 768) {
        sidebarOpen = !sidebarOpen;
        sidebar.classList.toggle('open', sidebarOpen);
    } else {
        sidebarOpen = !sidebarOpen;
        sidebar.classList.toggle('collapsed', !sidebarOpen);
    }
}

// ========== Handle Send ==========
async function handleSend() {
    const message = userInput.value.trim();
    if (!message || isProcessing) return;

    // Hide welcome
    if (welcomeSection) {
        welcomeSection.style.transition = 'opacity 0.3s';
        welcomeSection.style.opacity = '0';
        setTimeout(() => welcomeSection.remove(), 300);
    }

    // Clear input
    userInput.value = '';
    adjustTextareaHeight();
    charCount.textContent = '0 / 2000';
    charCount.className = 'char-count';

    // Add user message
    addMessage(message, 'user');

    // Lock UI
    setProcessing(true);

    // Stream from server
    await streamResponse(message);

    // Unlock UI
    setProcessing(false);
    userInput.focus();
}

// ========== Streaming ==========
async function streamResponse(message) {
    // Create bot message bubble
    const { msgEl, contentEl } = createBotBubble();

    let fullText = '';
    let cursorEl = document.createElement('span');
    cursorEl.className = 'streaming-cursor';
    contentEl.appendChild(cursorEl);

    try {
        const response = await fetch('/api/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const raw = line.slice(6).trim();
                    if (!raw) continue;
                    try {
                        const payload = JSON.parse(raw);
                        if (payload.token) {
                            fullText += payload.token;
                            // Live update: render raw text while streaming
                            contentEl.innerHTML = escapeStreamingText(fullText);
                            contentEl.appendChild(cursorEl);
                            scrollToBottom();
                        } else if (payload.done) {
                            // Streaming finished — render full markdown
                            cursorEl.remove();
                            renderMarkdown(contentEl, fullText);
                            addMessageActions(msgEl, fullText);
                            scrollToBottom();
                        } else if (payload.error) {
                            cursorEl.remove();
                            contentEl.innerHTML = `<span style="color:#ef4444;">Error: ${payload.error}</span>`;
                        }
                    } catch (parseErr) {
                        // Ignore malformed lines
                    }
                }
            }
        }

        // Fallback: if stream ended without 'done' signal
        if (cursorEl.parentNode) {
            cursorEl.remove();
            renderMarkdown(contentEl, fullText);
            addMessageActions(msgEl, fullText);
            scrollToBottom();
        }

    } catch (err) {
        console.error('Streaming error:', err);
        cursorEl.remove();
        if (fullText) {
            renderMarkdown(contentEl, fullText);
            addMessageActions(msgEl, fullText);
        } else {
            contentEl.innerHTML = '<span style="color:#ef4444;">Sorry, I had trouble connecting. Please try again.</span>';
        }
        scrollToBottom();
    }
}

// ========== Create Bot Bubble ==========
function createBotBubble() {
    const msgEl = document.createElement('div');
    msgEl.className = 'message bot';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'msg-avatar';
    avatarEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2v-5h2v5zm0-7h-2V7h2v2z" fill="currentColor"/></svg>`;

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';

    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';

    bodyEl.appendChild(contentEl);
    msgEl.appendChild(avatarEl);
    msgEl.appendChild(bodyEl);
    chatContainer.appendChild(msgEl);
    scrollToBottom();

    return { msgEl, contentEl, bodyEl };
}

// ========== Render Markdown ==========
function renderMarkdown(el, text) {
    if (typeof marked !== 'undefined') {
        el.innerHTML = marked.parse(text);
    } else {
        el.innerHTML = formatFallback(text);
    }
}

// Lightweight escape for live streaming (before markdown is applied)
function escapeStreamingText(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

// Fallback formatter if marked is not loaded
function formatFallback(text) {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}

// ========== Add Message Actions (timestamp + copy) ==========
function addMessageActions(msgEl, text) {
    const bodyEl = msgEl.querySelector('.msg-body');
    if (!bodyEl) return;

    const actionsEl = document.createElement('div');
    actionsEl.className = 'msg-actions';

    // Timestamp
    const timeEl = document.createElement('span');
    timeEl.className = 'msg-time';
    timeEl.textContent = getTime();
    actionsEl.appendChild(timeEl);

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.title = 'Copy response';
    copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M8 4v12a2 2 0 002 2h8a2 2 0 002-2V7.242a2 2 0 00-.602-1.43L16.083 2.57A2 2 0 0014.685 2H10a2 2 0 00-2 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M16 18v2a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
            copyBtn.classList.add('copied');
            copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            setTimeout(() => {
                copyBtn.classList.remove('copied');
                copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M8 4v12a2 2 0 002 2h8a2 2 0 002-2V7.242a2 2 0 00-.602-1.43L16.083 2.57A2 2 0 0014.685 2H10a2 2 0 00-2 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M16 18v2a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
            }, 2000);
        });
    });
    actionsEl.appendChild(copyBtn);

    bodyEl.appendChild(actionsEl);
}

// ========== Add User Message ==========
function addMessage(text, type) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${type}`;

    const avatarEl = document.createElement('div');
    avatarEl.className = 'msg-avatar';
    avatarEl.textContent = type === 'user' ? 'You' : 'AI';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';

    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    contentEl.textContent = text;

    const actionsEl = document.createElement('div');
    actionsEl.className = 'msg-actions';
    const timeEl = document.createElement('span');
    timeEl.className = 'msg-time';
    timeEl.textContent = getTime();
    actionsEl.appendChild(timeEl);

    bodyEl.appendChild(contentEl);
    bodyEl.appendChild(actionsEl);

    if (type === 'user') {
        msgEl.appendChild(bodyEl);
        msgEl.appendChild(avatarEl);
    } else {
        msgEl.appendChild(avatarEl);
        msgEl.appendChild(bodyEl);
    }

    chatContainer.appendChild(msgEl);
    scrollToBottom();
}

// ========== Clear Conversation ==========
async function handleClear() {
    if (isProcessing) return;
    if (!confirm('Clear the conversation?')) return;

    try {
        await fetch('/api/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        location.reload();
    } catch (e) {
        alert('Failed to clear. Please try again.');
    }
}

// ========== Helpers ==========
function setProcessing(active) {
    isProcessing = active;
    sendBtn.disabled = active;
    if (active) {
        setStatus('AI is thinking...', false);
        statusDot.classList.add('thinking');
    } else {
        setStatus('Online & Ready to Help', true);
        statusDot.classList.remove('thinking');
    }
}

function adjustTextareaHeight() {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 140) + 'px';
}

function updateCharCount() {
    const len = userInput.value.length;
    charCount.textContent = `${len} / 2000`;
    charCount.className = 'char-count' + (len > 1800 ? ' danger' : len > 1500 ? ' warn' : '');
}

function scrollToBottom() {
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
}

function getTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
