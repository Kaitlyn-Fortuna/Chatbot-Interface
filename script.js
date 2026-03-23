let apiKey = '';
let model = '';
let history = [];
let isLoading = false;

const setupPanel = document.getElementById('setup-panel');
const startBtn = document.getElementById('start-btn');
const apiKeyInput = document.getElementById('api-key-input');
const modelSelect = document.getElementById('model-select');
const modelLabel = document.getElementById('model-label');
const messagesEl = document.getElementById('messages');
const inputBox = document.getElementById('input-box');
const sendBtn = document.getElementById('send-btn');
const clearBtn = document.getElementById('clear-btn');
const emptyState = document.getElementById('empty-state');
const errorMsg = document.getElementById('error-msg');

// Start
startBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) { apiKeyInput.focus(); return; }
  apiKey = key;
  model = modelSelect.value;
  modelLabel.textContent = model.split('/')[1] || model;
  setupPanel.style.display = 'none';
  inputBox.focus();
});

apiKeyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') startBtn.click();
});

// Send message
sendBtn.addEventListener('click', sendMessage);
inputBox.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
inputBox.addEventListener('input', () => {
  inputBox.style.height = 'auto';
  inputBox.style.height = Math.min(inputBox.scrollHeight, 160) + 'px';
});

// Clear chat
clearBtn.addEventListener('click', () => {
  history = [];
  messagesEl.innerHTML = '';
  messagesEl.appendChild(emptyState);
  emptyState.style.display = 'flex';
  errorMsg.textContent = '';
});

async function sendMessage() {
  const text = inputBox.value.trim();
  if (!text || isLoading) return;
  if (!apiKey) { setupPanel.style.display = 'flex'; return; }

  errorMsg.textContent = '';
  emptyState.style.display = 'none';

  // Add user message
  history.push({ role: 'user', content: text });
  appendMessage('user', text);
  inputBox.value = '';
  inputBox.style.height = 'auto';

  // Typing indicator
  const typingEl = appendTyping();
  isLoading = true;
  sendBtn.disabled = true;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.href,
        'X-Title': 'chat//'
      },
      body: JSON.stringify({ model, messages: history, max_tokens: 1024 })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error?.message || `HTTP ${res.status}`);
    }

    const reply = data.choices?.[0]?.message?.content || '(empty response)';
    history.push({ role: 'assistant', content: reply });
    typingEl.remove();
    appendMessage('assistant', reply);

  } catch (err) {
    typingEl.remove();
    errorMsg.textContent = '⚠ ' + err.message;
    // Remove the last user message from history on error
    history.pop();
  } finally {
    isLoading = false;
    sendBtn.disabled = false;
    inputBox.focus();
  }
}

function appendMessage(role, content) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `
    <div class="msg-role">${role === 'user' ? 'you' : 'ai'}</div>
    <div class="msg-content">${escapeHtml(content)}</div>
  `;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function appendTyping() {
  const div = document.createElement('div');
  div.className = 'msg assistant';
  div.innerHTML = `
    <div class="msg-role">ai</div>
    <div class="msg-content"><div class="typing-dots"><span></span><span></span><span></span></div></div>
  `;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
