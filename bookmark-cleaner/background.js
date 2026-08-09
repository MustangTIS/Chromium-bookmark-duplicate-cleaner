// 拡張機能のアイコンがクリックされたときの処理
chrome.action.onClicked.addListener(async () => {
  // すでにオプションページ（専用タブ）が開きっぱなしであれば、そのタブにフォーカスを移動する
  const optionsUrl = chrome.runtime.getURL("options.html");
  const tabs = await chrome.tabs.query({ url: optionsUrl });

  if (tabs.length > 0) {
    chrome.tabs.update(tabs[0].id, { active: true });
    chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    // 開いていなければ新しくタブを開く
    chrome.tabs.create({ url: optionsUrl });
  }
});