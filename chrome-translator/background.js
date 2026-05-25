/**
 * Background Service Worker
 * 处理右键菜单、消息转发等
 */

// ===================== 右键菜单 =====================
chrome.runtime.onInstalled.addListener(() => {
  // 创建右键菜单
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '翻译「%s」',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'translate-page',
    title: '翻译整个页面',
    contexts: ['page']
  });

  // 设置初始默认配置
  chrome.storage.sync.get(['engine', 'showBubble', 'targetLang', 'sourceLang'], (s) => {
    const defaults = {};
    if (!s.engine) defaults.engine = 'mymemory';
    if (s.showBubble === undefined) defaults.showBubble = true;
    if (!s.targetLang) defaults.targetLang = 'zh';
    if (!s.sourceLang) defaults.sourceLang = 'auto';
    if (Object.keys(defaults).length > 0) {
      chrome.storage.sync.set(defaults);
    }
  });
});

// ===================== 右键菜单点击处理 =====================
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === 'translate-selection' && info.selectionText) {
    // 向 content script 发送翻译选中文字的指令
    chrome.tabs.sendMessage(tab.id, {
      type: 'TRANSLATE_SELECTION',
      text: info.selectionText
    }).catch(() => {
      // content script 未注入时，打开 popup
      chrome.action.openPopup();
    });
  } else if (info.menuItemId === 'translate-page') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'TRANSLATE_PAGE'
    }).catch(() => {});
  }
});

// ===================== 消息监听 =====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_POPUP') {
    chrome.action.openPopup().catch(() => {});
  }
  return false;
});

// ===================== 扩展图标点击（已有 popup，此处为备用）=====================
// 当 popup 无法打开时的 fallback
chrome.action.onClicked.addListener((tab) => {
  // popup 已配置，此回调通常不会触发
});
