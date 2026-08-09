// すべてのブックマークをフラットな配列で取得
function getAllBookmarks(node, list = []) {
  if (node.url) {
    list.push({ id: node.id, title: node.title, url: node.url, dateAdded: node.dateAdded || 0 });
  }
  if (node.children) {
    node.children.forEach(child => getAllBookmarks(child, list));
  }
  return list;
}

// URLを正規化して重複判定しやすくする関数
function normalizeUrl(rawUrl) {
  try {
    const urlObj = new URL(rawUrl);
    
    // YouTubeの個別動画の場合、タイムスタンプや不要なトラッキングパラメータを除外する
    if (urlObj.hostname.includes('youtube.com') && urlObj.pathname === '/watch') {
      const v = urlObj.searchParams.get('v');
      if (v) {
        // 動画IDだけで比較できるようにする（リストや再生位置パラメータを削る）
        return `https://www.youtube.com/watch?v=${v}`;
      }
    } else if (urlObj.hostname.includes('youtu.be')) {
      // youtu.be/VIDEO_ID の場合
      const videoId = urlObj.pathname.slice(1);
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    // YouTube以外の一般的なURLの場合：末尾のスラッシュを揃えるくらいにする
    return rawUrl.trim();
  } catch (e) {
    // 万が一URLの形式がおかしい場合はそのまま返す
    return rawUrl.trim();
  }
}

// スキャン処理
document.getElementById('scan-btn').addEventListener('click', runScan);

async function runScan() {
  const statusMsg = document.getElementById('status-msg');
  const resultsArea = document.getElementById('results-area');
  statusMsg.textContent = 'ブックマークをスキャン中...';
  resultsArea.innerHTML = '';

  const tree = await chrome.bookmarks.getTree();
  const allBookmarks = getAllBookmarks(tree[0]);

  const map = {};
  allBookmarks.forEach(b => {
    const url = normalizeUrl(b.url);
    if (!map[url]) map[url] = [];
    map[url].push(b);
  });

  const duplicates = Object.entries(map).filter(([url, items]) => items.length > 1);

  statusMsg.textContent = `重複グループ: ${duplicates.length}件 見つかりました。`;

  if (duplicates.length === 0) return;

  duplicates.forEach(([url, items]) => {
    // 日付順（古い順）にソートしておく
    items.sort((a, b) => a.dateAdded - b.dateAdded);

    const groupDiv = document.createElement('div');
    groupDiv.className = 'group';
    
    let html = `<div class="group-url">${url} (${items.length}件の重複)</div>`;
    
    items.forEach((item, index) => {
      const dateStr = item.dateAdded ? new Date(item.dateAdded).toLocaleString() : '不明';
      // デフォルトで「一番古いもの以外」にチェックを入れておく（自動整理の目安用にも便利）
      const isChecked = index > 0 ? 'checked' : ''; 
      
      html += `
        <div class="item">
          <div class="item-info">
            <input type="checkbox" class="target-chk" data-id="${item.id}" id="chk-${item.id}" ${isChecked}>
            <label for="chk-${item.id}"><strong>[${item.title || '無題'}]</strong></label>
            <span class="meta">追加日: ${dateStr}</span>
          </div>
        </div>
      `;
    });

    // グループごとの一括選択ヘルパー
    html += `
      <div class="group-actions">
        <a class="select-all-in-group">すべて選択</a>
        <a class="deselect-all-in-group">すべて解除</a>
        <a class="keep-newest-in-group">最新1件だけ残して他を選択</a>
      </div>
    `;

    groupDiv.innerHTML = html;

    // グループ内リンクのイベント設定
    const checkboxes = groupDiv.querySelectorAll('.target-chk');
    groupDiv.querySelector('.select-all-in-group').addEventListener('click', () => {
      checkboxes.forEach(cb => cb.checked = true);
    });
    groupDiv.querySelector('.deselect-all-in-group').addEventListener('click', () => {
      checkboxes.forEach(cb => cb.checked = false);
    });
    groupDiv.querySelector('.keep-newest-in-group').addEventListener('click', () => {
      // itemsは古い順なので、最後の要素（一番新しいもの）以外にチェックを入れる
      checkboxes.forEach((cb, idx) => {
        cb.checked = (idx < checkboxes.length - 1);
      });
    });

    resultsArea.appendChild(groupDiv);
  });
}

// 1. チェックした項目を削除
document.getElementById('delete-selected-btn').addEventListener('click', async () => {
  const checkedBoxes = document.querySelectorAll('.target-chk:checked');
  if (checkedBoxes.length === 0) {
    alert('削除する項目がチェックされていません。');
    return;
  }

  if (!confirm(`選択された ${checkedBoxes.length} 件のブックマークを削除しますか？`)) return;

  const idsToRemove = Array.from(checkedBoxes).map(cb => cb.dataset.id);
  
  for (const id of idsToRemove) {
    await chrome.bookmarks.remove(id);
  }

  alert('削除が完了しました。');
  runScan(); // 再スキャンして画面を更新
});

// 2. 一括自動整理（各グループで一番古いものを残し、他を自動で一括削除）
document.getElementById('auto-clean-btn').addEventListener('click', async () => {
  if (!confirm('【自動整理】すべての重複グループにおいて、「一番古いもの（最初に追加されたもの）」を1つだけ残し、残りの重複をすべて自動で削除します。よろしいですか？')) {
    return;
  }

  const tree = await chrome.bookmarks.getTree();
  const allBookmarks = getAllBookmarks(tree[0]);

  const map = {};
  allBookmarks.forEach(b => {
    const url = normalizeUrl(b.url);
    if (!map[url]) map[url] = [];
    map[url].push(b);
  });

  let removedCount = 0;
  for (const [url, items] of Object.entries(map)) {
    if (items.length > 1) {
      // 日付の古い順にソート
      items.sort((a, b) => a.dateAdded - b.dateAdded);
      
      // 先頭（一番古いもの）以外をすべて削除対象にする
      const targetsToRemove = items.slice(1);
      for (const item of targetsToRemove) {
        await chrome.bookmarks.remove(item.id);
        removedCount++;
      }
    }
  }

  alert(`${removedCount}件の重複ブックマークを自動削除しました。`);
  runScan();
});

// 3. バックアップ機能（JSON形式でダウンロード）
document.getElementById('backup-btn').addEventListener('click', async () => {
  const tree = await chrome.bookmarks.getTree();
  const jsonStr = JSON.stringify(tree, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `bookmarks_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});