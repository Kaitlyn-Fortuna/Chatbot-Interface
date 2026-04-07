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
const emptyWarning = document.getElementById('empty-warning');
const confirmOverlay = document.getElementById('confirm-overlay');
const confirmMessage = document.getElementById('confirm-message');
const confirmOk = document.getElementById('confirm-ok');
const confirmCancel = document.getElementById('confirm-cancel');

// --- Empty message warning helpers ---
function showEmptyWarning() {
  emptyWarning.classList.remove('visible');
  void emptyWarning.offsetWidth; // restart animation
  emptyWarning.classList.add('visible');
}

function hideEmptyWarning() {
  emptyWarning.classList.remove('visible');
}

// --- Confirm dialog helper ---
function showConfirm(message) {
  return new Promise(resolve => {
    confirmMessage.textContent = message;
    confirmOverlay.classList.add('active');

    function cleanup(result) {
      confirmOverlay.classList.remove('active');
      confirmOk.removeEventListener('click', onOk);
      confirmCancel.removeEventListener('click', onCancel);
      resolve(result);
    }

    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);

    confirmOk.addEventListener('click', onOk);
    confirmCancel.addEventListener('click', onCancel);
  });
}

// --- Start / configure ---
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

// --- Model badge: warn if chat has started ---
modelLabel.addEventListener('click', async () => {
  if (history.length > 0) {
    const ok = await showConfirm(
      'Changing the AI model will start a new conversation and clear the current chat. Continue?'
    );
    if (!ok) return;
    clearChat();
  }
  setupPanel.style.display = 'flex';
});

// --- Clear chat button: confirm first ---
clearBtn.addEventListener('click', async () => {
  if (history.length === 0) return;
  const ok = await showConfirm('Clear the entire conversation? This cannot be undone.');
  if (ok) clearChat();
});

function clearChat() {
  history = [];
  messagesEl.innerHTML = '';
  messagesEl.appendChild(emptyState);
  emptyState.style.display = 'flex';
  errorMsg.textContent = '';
}

// --- Send message ---
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

async function sendMessage() {
  const text = inputBox.value.trim();

  if (!text) {
    showEmptyWarning();
    inputBox.focus();
    return;
  }

  if (isLoading) return;

  hideEmptyWarning();

  if (!apiKey) { setupPanel.style.display = 'flex'; return; }

  errorMsg.textContent = '';
  emptyState.style.display = 'none';

  history.push({ role: 'user', content: text });
  appendMessage('user', text);
  inputBox.value = '';
  inputBox.style.height = 'auto';

  const typingEl = appendTyping();
  isLoading = true;
  sendBtn.disabled = true;

  try {
    const res = await fetch('http://localhost:5000/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, messages: history })
});

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

    const reply = data.reply || '(empty response)';
    history.push({ role: 'assistant', content: reply });
    typingEl.remove();
    appendMessage('assistant', reply);

  } catch (err) {
    typingEl.remove();
    errorMsg.textContent = '⚠ ' + err.message;
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
