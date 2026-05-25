// =================== 翻译引擎 ===================

function splitChunks(text, max = 490) {
  if (text.length <= max) return [text];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    if (i + max >= text.length) { chunks.push(text.slice(i)); break; }
    let end = i + max;
    while (end > i + max / 2 && !/[\s\.,;!?。，；！？]/.test(text[end])) end--;
    if (end === i + max / 2) end = i + max;
    chunks.push(text.slice(i, end).trim());
    i = end;
    while (i < text.length && text[i] === ' ') i++;
  }
  return chunks.filter(Boolean);
}

async function translateWithMyMemory(text, sl, tl, email) {
  const pair = `${sl === 'auto' ? 'autodetect' : sl}|${tl}`;
  const chunks = splitChunks(text);
  const results = await Promise.all(chunks.map(async chunk => {
    let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(pair)}`;
    if (email) url += `&de=${encodeURIComponent(email)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.responseStatus !== 200) throw new Error(d.responseDetails || '翻译失败');
    return d.responseData.translatedText;
  }));
  return results.join(' ');
}

async function translateWithGoogle(text, sl, tl) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  const result = Array.isArray(d[0]) ? d[0].map(i => i?.[0] || '').join('') : '';
  if (!result) throw new Error('翻译结果为空');
  return result;
}

async function translateWithLingva(text, sl, tl) {
  const sl2 = sl === 'auto' ? 'auto' : sl;
  const url = `https://lingva.ml/api/v1/${sl2}/${tl}/${encodeURIComponent(text)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (!d.translation) throw new Error('翻译结果为空');
  return d.translation;
}

async function runTranslate(text, sl, tl, engine, email) {
  switch (engine) {
    case 'google':  return translateWithGoogle(text, sl, tl);
    case 'lingva':  return translateWithLingva(text, sl, tl);
    default:        return translateWithMyMemory(text, sl, tl, email);
  }
}

// =================== DOM 引用 ===================

const inputText      = document.getElementById('inputText');
const outputText     = document.getElementById('outputText');
const translateBtn   = document.getElementById('translateBtn');
const btnText        = document.getElementById('btnText');
const btnLoading     = document.getElementById('btnLoading');
const charCount      = document.getElementById('charCount');
const clearBtn       = document.getElementById('clearBtn');
const copyBtn        = document.getElementById('copyBtn');
const speakBtn       = document.getElementById('speakBtn');
const swapBtn        = document.getElementById('swapBtn');
const sourceLang     = document.getElementById('sourceLang');
const targetLang     = document.getElementById('targetLang');
const settingsBtn    = document.getElementById('settingsBtn');
const settingsPanel  = document.getElementById('settingsPanel');
const engineSelect   = document.getElementById('engineSelect');
const autoTranslate  = document.getElementById('autoTranslateCheck');
const showBubble     = document.getElementById('showBubbleCheck');
const emailInput     = document.getElementById('emailInput');
const emailRow       = document.getElementById('emailRow');
const saveBtn        = document.getElementById('saveBtn');

let currentResult = '';
let autoTimer = null;

// =================== 初始化 ===================

function loadSettings() {
  chrome.storage.sync.get(
    ['sourceLang', 'targetLang', 'engine', 'autoTranslate', 'showBubble', 'email'],
    (s) => {
      if (s.sourceLang)              sourceLang.value    = s.sourceLang;
      if (s.targetLang)              targetLang.value    = s.targetLang;
      if (s.engine)                  engineSelect.value  = s.engine;
      autoTranslate.checked  = !!s.autoTranslate;
      showBubble.checked     = s.showBubble !== false;
      if (s.email)                   emailInput.value    = s.email;
      toggleEmailRow();
    }
  );
}

function toggleEmailRow() {
  emailRow.style.display = engineSelect.value === 'mymemory' ? 'flex' : 'none';
}

// =================== 字符计数 + 自动翻译 ===================

inputText.addEventListener('input', () => {
  charCount.textContent = inputText.value.length;
  if (autoTranslate.checked && inputText.value.trim()) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(doTranslate, 800);
  }
});

// =================== 清空 ===================

clearBtn.addEventListener('click', () => {
  inputText.value = '';
  charCount.textContent = '0';
  outputText.innerHTML  = '<span class="placeholder">翻译结果将显示在这里</span>';
  outputText.classList.remove('error');
  currentResult = '';
  inputText.focus();
});

// =================== 交换语言 ===================

swapBtn.addEventListener('click', () => {
  if (sourceLang.value === 'auto') return;
  const src = sourceLang.value;
  sourceLang.value = targetLang.value;
  targetLang.value = src;
  if (currentResult) {
    inputText.value = currentResult;
    charCount.textContent = currentResult.length;
    doTranslate();
  }
  saveLangs();
});

// =================== 翻译 ===================

translateBtn.addEventListener('click', doTranslate);

inputText.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doTranslate();
});

async function doTranslate() {
  const text = inputText.value.trim();
  if (!text) { toast('请输入要翻译的文字'); return; }

  setLoading(true);

  try {
    const s = await getStoredSettings();
    const result = await runTranslate(text, sourceLang.value, targetLang.value, s.engine, s.email);
    currentResult = result;
    outputText.classList.remove('error');
    outputText.innerHTML = '';
    result.split('\n').forEach((line, i) => {
      if (i > 0) outputText.appendChild(document.createElement('br'));
      outputText.appendChild(document.createTextNode(line));
    });
    saveLangs();
  } catch (err) {
    outputText.innerHTML = `翻译失败：${err.message}<br><small>请检查网络或切换翻译引擎</small>`;
    outputText.classList.add('error');
    currentResult = '';
  } finally {
    setLoading(false);
  }
}

function getStoredSettings() {
  return new Promise(resolve =>
    chrome.storage.sync.get(['engine', 'email'], s =>
      resolve({ engine: s.engine || 'mymemory', email: s.email || '' })
    )
  );
}

function setLoading(on) {
  translateBtn.disabled      = on;
  btnText.style.display      = on ? 'none'   : 'inline';
  btnLoading.style.display   = on ? 'inline' : 'none';
}

function saveLangs() {
  chrome.storage.sync.set({ sourceLang: sourceLang.value, targetLang: targetLang.value });
}

// =================== 复制 / 朗读 ===================

copyBtn.addEventListener('click', () => {
  if (!currentResult) return;
  navigator.clipboard.writeText(currentResult)
    .then(() => toast('✓ 已复制'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = currentResult;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('✓ 已复制');
    });
});

speakBtn.addEventListener('click', () => {
  if (!currentResult) return;
  if (!('speechSynthesis' in window)) { toast('当前浏览器不支持朗读'); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(currentResult);
  const map = { zh:'zh-CN', en:'en-US', ja:'ja-JP', ko:'ko-KR', fr:'fr-FR',
                de:'de-DE', es:'es-ES', ru:'ru-RU', pt:'pt-PT', ar:'ar-SA' };
  u.lang = map[targetLang.value] || 'en-US';
  window.speechSynthesis.speak(u);
});

// =================== 设置面板 ===================

settingsBtn.addEventListener('click', () => {
  settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'flex' : 'none';
});

engineSelect.addEventListener('change', toggleEmailRow);

saveBtn.addEventListener('click', () => {
  const data = {
    engine:        engineSelect.value,
    autoTranslate: autoTranslate.checked,
    showBubble:    showBubble.checked,
    email:         emailInput.value.trim()
  };
  chrome.storage.sync.set(data, () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SETTINGS_UPDATED', settings: data })
          .catch(() => {});
      }
    });
    toast('✓ 已保存');
    settingsPanel.style.display = 'none';
  });
});

// =================== Toast ===================

function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

// =================== 自动填入选中文字 ===================

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs[0]) return;
  chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_SELECTION' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res?.text?.trim()) {
      inputText.value = res.text.trim();
      charCount.textContent = inputText.value.length;
    }
  });
});

// =================== 启动 ===================
loadSettings();
