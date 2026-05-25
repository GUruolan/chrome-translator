/**
 * Content Script — 划词翻译气泡
 */
(function () {
  'use strict';
  if (window.__translatorInjected) return;
  window.__translatorInjected = true;

  // =================== 设置 ===================
  let settings = {
    showBubble: true,
    engine: 'mymemory',
    targetLang: 'zh',
    sourceLang: 'auto',
    email: ''
  };

  chrome.storage.sync.get(
    ['showBubble', 'engine', 'targetLang', 'sourceLang', 'email'],
    (s) => {
      if (s.showBubble !== undefined) settings.showBubble = s.showBubble;
      if (s.engine)     settings.engine     = s.engine;
      if (s.targetLang) settings.targetLang = s.targetLang;
      if (s.sourceLang) settings.sourceLang = s.sourceLang;
      if (s.email)      settings.email      = s.email;
    }
  );

  // =================== 翻译引擎 ===================
  async function translate(text) {
    const sl = settings.sourceLang || 'auto';
    const tl = settings.targetLang || 'zh';
    switch (settings.engine) {
      case 'google':  return translateGoogle(text, sl, tl);
      case 'lingva':  return translateLingva(text, sl, tl);
      default:        return translateMyMemory(text, sl, tl, settings.email);
    }
  }

  async function translateMyMemory(text, sl, tl, email) {
    const pair = `${sl === 'auto' ? 'autodetect' : sl}|${tl}`;
    let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`;
    if (email) url += `&de=${encodeURIComponent(email)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.responseStatus !== 200) throw new Error(d.responseDetails || '翻译失败');
    return d.responseData.translatedText;
  }

  async function translateGoogle(text, sl, tl) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const result = Array.isArray(d[0]) ? d[0].map(i => i?.[0] || '').join('') : '';
    if (!result) throw new Error('翻译结果为空');
    return result;
  }

  async function translateLingva(text, sl, tl) {
    const url = `https://lingva.ml/api/v1/${sl}/${tl}/${encodeURIComponent(text)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (!d.translation) throw new Error('翻译结果为空');
    return d.translation;
  }

  // =================== 气泡 ===================
  let bubble = null;
  let lastText = '';
  let translateTimer = null;

  function initBubble() {
    if (bubble) return;
    bubble = document.createElement('div');
    bubble.id = '__tb__';
    bubble.innerHTML = `
      <div class="__tb_head__">
        <span class="__tb_label__">🌐 翻译</span>
        <button class="__tb_x__" title="关闭">✕</button>
      </div>
      <div class="__tb_body__">
        <div class="__tb_spin__"></div>
        <div class="__tb_text__"></div>
        <div class="__tb_err__"></div>
      </div>
      <div class="__tb_foot__">
        <button class="__tb_copy__">📋 复制</button>
      </div>`;
    document.documentElement.appendChild(bubble);

    bubble.querySelector('.__tb_x__').addEventListener('click', hideBubble);

    bubble.querySelector('.__tb_copy__').addEventListener('click', (e) => {
      const text = bubble.querySelector('.__tb_text__').textContent;
      if (!text) return;
      navigator.clipboard.writeText(text).catch(() => {});
      const btn = e.currentTarget;
      btn.textContent = '✓ 已复制';
      setTimeout(() => { btn.textContent = '📋 复制'; }, 1500);
    });

    // mousedown 拦截：防止点击气泡内部触发外部的关闭逻辑
    bubble.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // CSS 全部加了 !important，JS 必须用 setProperty priority='important' 才能覆盖
  function setDisplay(el, value) {
    el.style.setProperty('display', value, 'important');
  }

  function showBubble(x, y) {
    initBubble();

    // 重置内容区
    setDisplay(bubble.querySelector('.__tb_spin__'), 'flex');
    setDisplay(bubble.querySelector('.__tb_text__'), 'none');
    setDisplay(bubble.querySelector('.__tb_err__'),  'none');
    setDisplay(bubble.querySelector('.__tb_foot__'), 'none');

    // 先隐式显示以获取实际尺寸
    bubble.style.visibility = 'hidden';
    bubble.style.display    = 'block';

    const bw  = bubble.offsetWidth  || 360;
    const bh  = bubble.offsetHeight || 140;
    const vw  = window.innerWidth;
    const vh  = window.innerHeight;
    const gap = 10;

    let left = x - bw / 2;
    let top  = y + gap;
    if (left + bw > vw - gap) left = vw - bw - gap;
    if (left < gap)           left = gap;
    if (top  + bh > vh - gap) top  = y - bh - gap;
    if (top  < gap)           top  = gap;

    bubble.style.left       = `${left}px`;
    bubble.style.top        = `${top}px`;
    bubble.style.visibility = 'visible';
  }

  function hideBubble() {
    if (!bubble) return;
    bubble.style.display = 'none';
    // 不清 lastText！否则 mouseup setTimeout 会把同一段选区视为新文字重新显示气泡
    clearTimeout(translateTimer);
  }

  function setResult(text) {
    if (!bubble || bubble.style.display === 'none') return;
    setDisplay(bubble.querySelector('.__tb_spin__'), 'none');
    const el = bubble.querySelector('.__tb_text__');
    el.textContent = text;
    setDisplay(el, 'block');
    setDisplay(bubble.querySelector('.__tb_foot__'), 'flex');
  }

  function setError(msg) {
    if (!bubble || bubble.style.display === 'none') return;
    setDisplay(bubble.querySelector('.__tb_spin__'), 'none');
    const el = bubble.querySelector('.__tb_err__');
    el.textContent = msg;
    setDisplay(el, 'block');
    setDisplay(bubble.querySelector('.__tb_foot__'), 'flex');
  }

  // =================== 事件 ===================

  // 划词后显示气泡
  document.addEventListener('mouseup', () => {
    setTimeout(() => {
      if (!settings.showBubble) return;

      const sel  = window.getSelection();
      const text = sel?.toString().trim() || '';
      if (!text) return;
      if (text === lastText) return; // 相同文字（包括关闭后同一选区）不重复显示
      lastText = text;

      // 定位到选区底部中央
      let x = 0, y = 0;
      try {
        if (sel.rangeCount > 0) {
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          x = rect.left + rect.width / 2;
          y = rect.bottom;
        }
      } catch (_) {}

      showBubble(x, y);

      clearTimeout(translateTimer);
      translateTimer = setTimeout(async () => {
        try {
          setResult(await translate(text));
        } catch (err) {
          setError(`翻译失败：${err.message}`);
        }
      }, 200);
    }, 0);
  });

  // 点击气泡外部 → 关闭，并重置 lastText 以允许下次重新选同一段文字
  document.addEventListener('mousedown', (e) => {
    if (bubble?.contains(e.target)) return; // 在气泡内部，放行
    if (bubble?.style.display !== 'none') hideBubble();
    lastText = ''; // 新选词手势开始，清除记忆
  });

  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideBubble();
  });

  // 消息
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_SELECTION') {
      sendResponse({ text: window.getSelection()?.toString() || '' });
    } else if (msg.type === 'SETTINGS_UPDATED') {
      Object.assign(settings, msg.settings);
      if (!settings.showBubble) hideBubble();
    }
    return true;
  });

})();
