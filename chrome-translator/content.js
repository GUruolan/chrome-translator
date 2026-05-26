/**
 * Content Script — 划词翻译
 * 流程：选词 → 小圆点 → hover → 翻译气泡
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

  // MyMemory 慢时的超时降级：超过 ms 毫秒自动抛出，外层 catch 转 Google
  function raceTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('__timeout__')), ms))
    ]);
  }

  async function translate(text) {
    const sl = settings.sourceLang || 'auto';
    const tl = settings.targetLang || 'zh';
    switch (settings.engine) {
      case 'google': return translateGoogle(text, sl, tl);
      case 'lingva': return translateLingva(text, sl, tl);
      default: {
        try {
          return await raceTimeout(translateMyMemory(text, sl, tl, settings.email), 1500);
        } catch (err) {
          if (err.message === '__timeout__') return translateGoogle(text, sl, tl);
          throw err;
        }
      }
    }
  }

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

  async function translateMyMemory(text, sl, tl, email) {
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

  // =================== 状态 ===================
  let dot          = null;
  let bubble       = null;
  let lastText     = '';
  let pendingText  = '';    // dot 对应的待翻译文字
  let cachedResult = null;  // null=翻译中, string=成功, Error=失败
  let hideTimer    = null;
  let translateTimer = null;

  // CSS !important 需要用 setProperty 覆盖
  function setDisplay(el, value) {
    el.style.setProperty('display', value, 'important');
  }

  // =================== 小圆点 ===================
  function initDot() {
    if (dot) return;
    dot = document.createElement('div');
    dot.id = '__tb_dot__';
    document.documentElement.appendChild(dot);

    dot.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      triggerBubble();
    });

    dot.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(hideBubble, 200);
    });

    // 阻止 dot 上的 mousedown 触发外部关闭
    dot.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  function showDot(x, y, text) {
    initDot();
    pendingText  = text;
    cachedResult = null;
    dot.style.left = `${x}px`;
    dot.style.top  = `${y}px`;
    dot.style.setProperty('display', 'flex', 'important');

    // 立即开始翻译（无延迟），用 myText 做版本校验防止乱序结果
    const myText = text;
    (async () => {
      try {
        const result = await translate(myText);
        if (myText !== pendingText) return;
        cachedResult = result;
      } catch (err) {
        if (myText !== pendingText) return;
        cachedResult = err;
      }
      if (bubble?.style.display !== 'none') renderBubbleContent();
    })();
  }

  function hideDot() {
    if (dot) dot.style.setProperty('display', 'none', 'important');
  }

  // =================== 翻译气泡 ===================
  function initBubble() {
    if (bubble) return;
    bubble = document.createElement('div');
    bubble.id = '__tb__';
    bubble.innerHTML = `
      <div class="__tb_head__">
        <span class="__tb_label__">🌐 翻译</span>
        <div class="__tb_actions__">
          <button class="__tb_copy__" title="复制">📋</button>
          <button class="__tb_x__" title="关闭">✕</button>
        </div>
      </div>
      <div class="__tb_body__">
        <div class="__tb_spin__"></div>
        <div class="__tb_text__"></div>
        <div class="__tb_err__"></div>
      </div>`;
    document.documentElement.appendChild(bubble);

    bubble.querySelector('.__tb_x__').addEventListener('click', () => {
      hideBubble();
      hideDot();
      lastText = '';
    });

    bubble.querySelector('.__tb_copy__').addEventListener('click', (e) => {
      const text = bubble.querySelector('.__tb_text__').textContent;
      if (!text) return;
      navigator.clipboard.writeText(text).catch(() => {});
      const btn = e.currentTarget;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '📋'; }, 1500);
    });

    bubble.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    bubble.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(hideBubble, 200);
    });

    // 阻止 bubble 上的 mousedown 触发外部关闭
    bubble.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // 根据 cachedResult 渲染气泡内容
  function renderBubbleContent() {
    if (!bubble || bubble.style.display === 'none') return;
    if (cachedResult === null) {
      setDisplay(bubble.querySelector('.__tb_spin__'), 'flex');
      setDisplay(bubble.querySelector('.__tb_text__'), 'none');
      setDisplay(bubble.querySelector('.__tb_err__'),  'none');
    } else if (cachedResult instanceof Error) {
      setDisplay(bubble.querySelector('.__tb_spin__'), 'none');
      const el = bubble.querySelector('.__tb_err__');
      el.textContent = `翻译失败：${cachedResult.message}`;
      setDisplay(el, 'block');
    } else {
      setDisplay(bubble.querySelector('.__tb_spin__'), 'none');
      const el = bubble.querySelector('.__tb_text__');
      el.textContent = cachedResult;
      setDisplay(el, 'block');
    }
  }

  // hover 到 dot 时触发：定位并展示气泡（翻译已在后台运行）
  function triggerBubble() {
    if (!pendingText) return;

    const dotRect = dot.getBoundingClientRect();
    const bx = dotRect.left + dotRect.width / 2;
    const by = dotRect.bottom + 4;

    initBubble();

    bubble.style.visibility = 'hidden';
    bubble.style.display    = 'block';

    const bw  = bubble.offsetWidth  || 360;
    const bh  = bubble.offsetHeight || 140;
    const vw  = window.innerWidth;
    const vh  = window.innerHeight;
    const gap = 10;

    let left = bx - bw / 2;
    let top  = by;
    if (left + bw > vw - gap) left = vw - bw - gap;
    if (left < gap)           left = gap;
    if (top  + bh > vh - gap) top  = dotRect.top - bh - 4;
    if (top  < gap)           top  = gap;

    bubble.style.left       = `${left}px`;
    bubble.style.top        = `${top}px`;
    bubble.style.visibility = 'visible';

    renderBubbleContent();
  }

  function hideBubble() {
    if (!bubble) return;
    bubble.style.display = 'none';
  }

  // =================== 事件 ===================

  // 选词后立即显示小圆点
  document.addEventListener('mouseup', (e) => {
    setTimeout(() => {
      if (!settings.showBubble) return;

      const sel  = window.getSelection();
      const text = sel?.toString().trim() || '';
      if (!text || text === lastText) return;
      lastText = text;

      // 圆点出现在鼠标松开位置的右下方
      const x = e.clientX + 6;
      const y = e.clientY + 6;

      hideBubble();
      showDot(x, y, text);
    }, 0);
  });

  // mousedown 在 dot/bubble 外部 → 全部关闭
  document.addEventListener('mousedown', (e) => {
    if (dot?.contains(e.target) || bubble?.contains(e.target)) return;
    clearTimeout(hideTimer);
    hideBubble();
    hideDot();
    lastText = '';
  });

  // ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideBubble();
      hideDot();
      lastText = '';
    }
  });

  // 消息
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_SELECTION') {
      sendResponse({ text: window.getSelection()?.toString() || '' });
    } else if (msg.type === 'SETTINGS_UPDATED') {
      Object.assign(settings, msg.settings);
      if (!settings.showBubble) { hideBubble(); hideDot(); }
    }
    return true;
  });

})();
