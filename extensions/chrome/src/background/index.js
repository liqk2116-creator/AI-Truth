// Service worker - handles badge updates

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== 'updateBadge' || !sender.tab?.id) return;

  const { red, orange, gray, green } = message.counts;
  const total = red + orange + (gray || 0) + green;

  if (red > 0) {
    chrome.action.setBadgeText({ text: String(red), tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444', tabId: sender.tab.id });
  } else if (orange > 0) {
    chrome.action.setBadgeText({ text: String(orange), tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#F97316', tabId: sender.tab.id });
  } else if (total > 0) {
    chrome.action.setBadgeText({ text: String(total), tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#10B981', tabId: sender.tab.id });
  } else {
    chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
  }
});
