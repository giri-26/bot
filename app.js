/* ═══════════════════════════════════════════════════════════
   Ollama Chat — app.js
   All 20 features implemented
═══════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────
const state = {
  history:      [],        // [{role, content}]
  mode:         'general',
  language:     'English',
  shortMode:    false,
  stepMode:     false,
  ttsEnabled:   false,
  model:        'llama3',
  imageB64:     null,
  pinnedMsgs:   [],        // array of {id, text}
  lastBotText:  '',        // for regenerate
  lastUserMsg:  '',        // for regenerate
  isGenerating: false,
  recognition:  null,
};

// ── DOM refs ──────────────────────────────────────────────
const chat        = document.getElementById('chat');
const input       = document.getElementById('msg-input');
const modelSel    = document.getElementById('model-sel');
const langSel     = document.getElementById('lang-sel');
const voiceBtn    = document.getElementById('voice-btn');
const imgPreview  = document.getElementById('img-preview');
const imgThumb    = document.getElementById('img-thumb');
const typingEl    = document.getElementById('typing-indicator');
const toast       = document.getElementById('toast');

// ── Init ──────────────────────────────────────────────────
(async function init() {
  loadModels();
  renderWelcome();
  loadNotes();

  // Toggle listeners
  document.getElementById('short-toggle').addEventListener('change', e => { state.shortMode = e.target.checked; });
  document.getElementById('step-toggle').addEventListener('change',  e => { state.stepMode  = e.target.checked; });
  document.getElementById('tts-toggle').addEventListener('change',   e => { state.ttsEnabled = e.target.checked; });
  langSel.addEventListener('change',  e => { state.language = e.target.value; });
  modelSel.addEventListener('change', e => { state.model    = e.target.value; });

  // Sidebar overlay for mobile
  const overlay = document.createElement('div');
  overlay.id = 'sidebar-overlay';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', closeSidebar);
})();

// ── Load models ───────────────────────────────────────────
async function loadModels() {
  try {
    const res    = await fetch('/api/models');
    const data   = await res.json();
    const models = data.models || ['llama3'];
    modelSel.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
    state.model = models[0];
  } catch {
    modelSel.innerHTML = '<option>llama3</option>';
  }
}

// ── Welcome screen ────────────────────────────────────────
function renderWelcome() {
  const suggestions = [
    { icon: '✍️', title: 'Write for me', prompt: 'Write a short professional email asking for a meeting.' },
    { icon: '💡', title: 'Explain it',   prompt: 'Explain how neural networks work in simple terms.' },
    { icon: '🐛', title: 'Debug code',   prompt: 'Help me debug a Python function that returns wrong output.' },
    { icon: '📝', title: 'Summarize',    prompt: 'Summarize the key points of the latest AI trends.' },
  ];

  const welcome = document.createElement('div');
  welcome.id = 'welcome';
  welcome.innerHTML = `
    <div class="icon">🤖</div>
    <h2>How can I help you today?</h2>
    <div class="suggestion-grid">
      ${suggestions.map(s => `
        <button class="suggestion-card" onclick="quickSend('${s.prompt.replace(/'/g, "\\'")}')">
          <strong>${s.icon} ${s.title}</strong>${s.prompt.slice(0, 55)}...
        </button>
      `).join('')}
    </div>
  `;
  chat.appendChild(welcome);

  // Also add typing indicator to chat
  const typing = document.createElement('div');
  typing.id = 'typing-indicator';
  typing.style.cssText = 'display:none;align-self:flex-start;background:var(--bot-bg);border:1px solid var(--bot-border);border-radius:16px;border-bottom-left-radius:4px;padding:12px 18px;gap:5px;align-items:center;';
  typing.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  chat.appendChild(typing);
}

function quickSend(prompt) {
  input.value = prompt;
  sendMessage();
}

// ── Send message ──────────────────────────────────────────
async function sendMessage(overrideMsg) {
  if (state.isGenerating) return;

  const userText = overrideMsg || input.value.trim();
  if (!userText && !state.imageB64) return;

  // Remove welcome
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();

  input.value = '';
  input.style.height = 'auto';

  state.lastUserMsg = userText;

  // Add user bubble
  addBubble('user', userText, state.imageB64 ? imgThumb.src : null);

  // Reset image
  const imgB64 = state.imageB64;
  clearImage();

  // Add history
  state.history.push({ role: 'user', content: userText });

  // Show typing
  showTyping(true);
  state.isGenerating = true;

  // Create bot bubble
  const botId   = 'msg-' + Date.now();
  const bubble  = addBubble('bot', '', null, botId);
  const content = bubble.querySelector('.bubble-content');

  let fullText = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:    userText,
        history:    state.history.slice(0, -1),
        mode:       state.mode,
        language:   state.language,
        short_mode: state.shortMode,
        step_mode:  state.stepMode,
        model:      state.model,
        image:      imgB64 || null,
      }),
    });

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    showTyping(false);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.error) {
            content.innerHTML = `<span style="color:var(--danger)">⚠️ ${parsed.error}</span>`;
            break;
          }
          if (parsed.token) {
            fullText += parsed.token;
            content.innerHTML = formatText(fullText);
            scrollToBottom();
          }
        } catch {}
      }
    }

    state.lastBotText = fullText;
    state.history.push({ role: 'assistant', content: fullText });

    if (state.ttsEnabled && fullText) speak(fullText);

  } catch (err) {
    showTyping(false);
    content.innerHTML = `<span style="color:var(--danger)">⚠️ ${err.message}</span>`;
  }

  state.isGenerating = false;
  scrollToBottom();
}

// ── Add bubble ────────────────────────────────────────────
function addBubble(role, text, imgSrc, id) {
  const wrap = document.createElement('div');
  wrap.className = `msg-wrap ${role}`;
  if (id) wrap.id = id;

  const avatar = role === 'user' ? '👤' : '🤖';

  let imgHtml = imgSrc ? `<img src="${imgSrc}" alt="uploaded" />` : '';

  let actions = '';
  if (role === 'bot') {
    actions = `
      <div class="bubble-actions">
        <button class="act-btn" onclick="copyBubble(this)">📋 Copy</button>
        <button class="act-btn" onclick="pinBubble(this)">📌 Pin</button>
        <button class="act-btn" onclick="regenLast()">🔄 Regenerate</button>
        <button class="act-btn" onclick="speakBubble(this)">🔊 Speak</button>
        <button class="act-btn" onclick="addToNotes(this)">🧾 Note</button>
      </div>
    `;
  }

  wrap.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="bubble">
      ${imgHtml}
      <div class="bubble-content">${formatText(text)}</div>
      ${actions}
    </div>
  `;

  // Insert before typing indicator
  const typing = document.getElementById('typing-indicator');
  if (typing) chat.insertBefore(wrap, typing);
  else chat.appendChild(wrap);

  scrollToBottom();
  return wrap;
}

// ── Format text (markdown-lite) ───────────────────────────
function formatText(text) {
  if (!text) return '';
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h4 style="margin:.6em 0 .2em;color:var(--accent)">$1</h4>')
    .replace(/^## (.+)$/gm,  '<h3 style="margin:.6em 0 .2em">$1</h3>')
    .replace(/^# (.+)$/gm,   '<h2 style="margin:.6em 0 .2em">$1</h2>')
    .replace(/^\d+\. (.+)$/gm, '<div style="margin:3px 0;padding-left:6px">$&</div>')
    .replace(/^[-*] (.+)$/gm,  '<div style="margin:2px 0;padding-left:8px">• $1</div>')
    .replace(/\n/g, '<br/>');
}

// ── Typing indicator ──────────────────────────────────────
function showTyping(show) {
  const el = document.getElementById('typing-indicator');
  if (!el) return;
  el.style.display = show ? 'flex' : 'none';
  if (show) scrollToBottom();
}

// ── Scroll ────────────────────────────────────────────────
function scrollToBottom() {
  chat.scrollTop = chat.scrollHeight;
}

// ── Enter key ─────────────────────────────────────────────
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── Auto-resize textarea ──────────────────────────────────
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}

// ── Mode switch ───────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  showToast(`Mode: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
}

// ── Clear chat ────────────────────────────────────────────
function clearChat() {
  state.history   = [];
  state.lastBotText = '';
  state.lastUserMsg = '';
  chat.innerHTML  = '';
  renderWelcome();
  showToast('Chat cleared');
}

// ── Save / download chat ──────────────────────────────────
function saveChat() {
  const lines = Array.from(chat.querySelectorAll('.msg-wrap')).map(wrap => {
    const role = wrap.classList.contains('user') ? 'You' : 'Bot';
    const text = wrap.querySelector('.bubble-content')?.innerText || '';
    return `[${role}]\n${text}\n`;
  }).join('\n---\n\n');

  const blob = new Blob([lines], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `ollama-chat-${Date.now()}.txt` });
  a.click();
  URL.revokeObjectURL(url);
  showToast('Chat saved!');
}

// ── Copy bubble ───────────────────────────────────────────
function copyBubble(btn) {
  const text = btn.closest('.bubble').querySelector('.bubble-content')?.innerText || '';
  navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
}

// ── Pin bubble ────────────────────────────────────────────
function pinBubble(btn) {
  const bubble = btn.closest('.bubble');
  const text   = bubble.querySelector('.bubble-content')?.innerText || '';
  const id     = 'pin-' + Date.now();

  bubble.classList.toggle('pinned-bubble');
  const isPinned = bubble.classList.contains('pinned-bubble');

  if (isPinned) {
    state.pinnedMsgs.push({ id, text });
    btn.textContent = '📌 Unpin';
    showToast('Message pinned!');
  } else {
    state.pinnedMsgs = state.pinnedMsgs.filter(p => p.text !== text);
    btn.textContent = '📌 Pin';
    showToast('Unpinned');
  }
}

// ── Regenerate last response ──────────────────────────────
async function regenLast() {
  if (!state.lastUserMsg || state.isGenerating) return;
  // Remove last bot message from history
  if (state.history.length >= 2) state.history.splice(-2);

  // Remove last bot bubble from DOM
  const bots = chat.querySelectorAll('.msg-wrap.bot');
  if (bots.length) bots[bots.length - 1].remove();

  // Remove last user bubble
  const users = chat.querySelectorAll('.msg-wrap.user');
  if (users.length) users[users.length - 1].remove();

  await sendMessage(state.lastUserMsg);
}

// ── Speak bubble ──────────────────────────────────────────
function speakBubble(btn) {
  const text = btn.closest('.bubble').querySelector('.bubble-content')?.innerText || '';
  speak(text);
}

function speak(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text.slice(0, 800));
  const voices = speechSynthesis.getVoices();
  const voice  = voices.find(v => v.lang.startsWith('en')) || voices[0];
  if (voice) utt.voice = voice;
  utt.rate   = 0.95;
  utt.pitch  = 1;
  speechSynthesis.speak(utt);
}

// ── Voice input ───────────────────────────────────────────
function toggleVoice() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    showToast('Voice input not supported in this browser.'); return;
  }

  if (state.recognition) {
    state.recognition.stop();
    state.recognition = null;
    voiceBtn.classList.remove('recording');
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang          = 'en-US';
  rec.interimResults = true;

  rec.onstart = () => {
    voiceBtn.classList.add('recording');
    showToast('🎤 Listening...');
  };
  rec.onresult = (e) => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
    input.value = transcript;
  };
  rec.onend = () => {
    voiceBtn.classList.remove('recording');
    state.recognition = null;
    if (input.value.trim()) sendMessage();
  };
  rec.onerror = () => {
    voiceBtn.classList.remove('recording');
    state.recognition = null;
    showToast('Voice error. Try again.');
  };

  state.recognition = rec;
  rec.start();
}

// ── Image upload ──────────────────────────────────────────
async function handleImage(event) {
  const file = event.target.files[0];
  if (!file) return;

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res  = await fetch('/api/upload-image', { method: 'POST', body: fd });
    const data = await res.json();
    state.imageB64 = data.base64;

    imgThumb.src       = URL.createObjectURL(file);
    imgPreview.style.display = 'flex';
    input.placeholder  = 'Ask about this image...';
    input.focus();
  } catch {
    showToast('Image upload failed.');
  }
  event.target.value = '';
}

function clearImage() {
  state.imageB64         = null;
  imgPreview.style.display = 'none';
  imgThumb.src           = '';
  input.placeholder      = 'Type a message... (Enter to send)';
}

// ── Image generation ──────────────────────────────────────
function openImageGen() {
  document.getElementById('imggen-modal').classList.add('open');
  document.getElementById('imggen-prompt').focus();
}

async function generateImage() {
  const prompt = document.getElementById('imggen-prompt').value.trim();
  if (!prompt) { showToast('Enter a prompt first.'); return; }

  const result = document.getElementById('imggen-result');
  result.innerHTML = '<span style="color:var(--muted);font-size:.85rem">⏳ Generating...</span>';

  try {
    const res  = await fetch('/api/generate-image', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();

    if (data.image_url) {
      result.innerHTML = `
        <img src="${data.image_url}" alt="generated" style="max-width:100%;border-radius:12px;border:1px solid var(--border);margin-top:4px;" />
        <div style="margin-top:8px;">
          <a href="${data.image_url}" download="generated.jpg" target="_blank"
             style="color:var(--accent);font-size:.82rem;text-decoration:none;">⬇️ Download image</a>
        </div>
      `;
      // Also add to chat
      closeModal('imggen-modal');
      addBubble('bot', `🎨 Generated image for: *${prompt}*\n\n![generated](${data.image_url})`, null);
    } else {
      result.innerHTML = `<span style="color:var(--danger)">Failed: ${data.error}</span>`;
    }
  } catch (e) {
    result.innerHTML = `<span style="color:var(--danger)">Error: ${e.message}</span>`;
  }
}

// ── Notes ─────────────────────────────────────────────────
function showNotes() {
  document.getElementById('notes-modal').classList.add('open');
}

function clearNotes() {
  document.getElementById('notes-area').value = '';
  localStorage.removeItem('ollama-notes');
}

function copyNotes() {
  const text = document.getElementById('notes-area').value;
  navigator.clipboard.writeText(text).then(() => showToast('Notes copied!'));
}

function addToNotes(btn) {
  const text = btn.closest('.bubble').querySelector('.bubble-content')?.innerText || '';
  const area = document.getElementById('notes-area');
  area.value += (area.value ? '\n\n---\n' : '') + text;
  saveNotes();
  showToast('Added to notes!');
}

async function generateNotes() {
  const msgs  = Array.from(chat.querySelectorAll('.msg-wrap.bot'))
    .map(m => m.querySelector('.bubble-content')?.innerText || '')
    .filter(Boolean).join('\n\n');

  if (!msgs) { showToast('No bot messages to summarize.'); return; }

  const area = document.getElementById('notes-area');
  area.value = '⏳ Generating notes...';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        message:  `Create concise bullet-point notes from this content:\n\n${msgs.slice(0, 3000)}`,
        history:  [],
        mode:     'general',
        language: state.language,
      }),
    });

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let full      = '';
    area.value    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const p = JSON.parse(line.slice(6));
          if (p.token) { full += p.token; area.value = full; }
        } catch {}
      }
    }
    saveNotes();
  } catch (e) {
    area.value = 'Error: ' + e.message;
  }
}

function saveNotes() {
  localStorage.setItem('ollama-notes', document.getElementById('notes-area').value);
}

function loadNotes() {
  const saved = localStorage.getItem('ollama-notes');
  if (saved) document.getElementById('notes-area').value = saved;
}

// Auto-save notes as user types
document.getElementById('notes-area')?.addEventListener('input', saveNotes);

// ── Pinned messages modal ─────────────────────────────────
function showPinned() {
  const list  = document.getElementById('pinned-list');
  const noPins= document.getElementById('no-pins');
  list.innerHTML = '';

  if (state.pinnedMsgs.length === 0) {
    noPins.style.display = 'block';
  } else {
    noPins.style.display = 'none';
    state.pinnedMsgs.forEach(p => {
      const item = document.createElement('div');
      item.className = 'pin-item';
      item.textContent = p.text.slice(0, 200) + (p.text.length > 200 ? '...' : '');
      list.appendChild(item);
    });
  }

  document.getElementById('pinned-modal').classList.add('open');
}

// ── Modals ────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ── Theme toggle ──────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  document.getElementById('theme-btn').textContent = isDark ? '🌙 Dark Mode' : '☀️ Light Mode';
  showToast(isDark ? 'Light mode on' : 'Dark mode on');
}

// ── Sidebar (mobile) ─────────────────────────────────────
function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const isOpen   = sidebar.classList.contains('open');
  sidebar.classList.toggle('open', !isOpen);
  overlay.classList.toggle('open', !isOpen);
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg) {
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.style.opacity = '0', 2200);
}

// ── Keyboard shortcuts ────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['notes-modal','pinned-modal','imggen-modal'].forEach(closeModal);
    closeSidebar();
  }
});
