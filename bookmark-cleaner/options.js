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

// 4. YouTube等の不要なパラメータやハッシュを削除してURLを綺麗にクリーンアップする機能
document.getElementById('clean-urls-btn').addEventListener('click', async () => {
  if (!confirm('【URLクリーンアップ】全ブックマークを走査し、YouTubeの不要なパラメータ（再生位置やトラッキング等）や不要なハッシュがついているものを、スッキリした基本URLに一括で書き換えます。\n\n実行前に「現在の全ブックマークをバックアップ」を取ることをおすすめします。よろしいですか？')) {
    return;
  }

  const statusMsg = document.getElementById('status-msg');
  statusMsg.textContent = 'ブックマークのURLをクリーンアップ中...';

  const tree = await chrome.bookmarks.getTree();
  const allBookmarks = getAllBookmarks(tree[0]);

  let updatedCount = 0;

  for (const b of allBookmarks) {
    const cleanedUrl = normalizeUrl(b.url); // 既存のnormalizeUrl関数を活用！

    // もし正規化前後でURLが変わる（＝不要なパラメータやハッシュが含まれていた）場合のみ更新
    if (b.url !== cleanedUrl) {
      try {
        await chrome.bookmarks.update(b.id, { url: cleanedUrl });
        updatedCount++;
      } catch (e) {
        console.error(`更新失敗 (ID: ${b.id}, URL: ${b.url}):`, e);
      }
    }
  }

  statusMsg.textContent = `クリーンアップ完了: ${updatedCount}件のURLを綺麗に整えました。`;
  alert(`${updatedCount}件のブックマークURLをクリーンアップしました！`);

  // 必要に応じて自動で再スキャンを走らせる
  runScan();
});

// 5. URL文字列の一括置換機能（例: twitter.com -> x.com など）
// 「URLを置換」ボタンで入力パネルの表示/非表示を切り替え
document.getElementById('toggle-replace-btn').addEventListener('click', () => {
  const panel = document.getElementById('replace-panel');
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    document.getElementById('replace-from').focus();
  }
});

// 「対象を一覧表示」ボタン：ヒットしたブックマークをチェック付きで一覧表示する
document.getElementById('preview-replace-btn').addEventListener('click', async () => {
  const fromStr = document.getElementById('replace-from').value;
  const toStr = document.getElementById('replace-to').value;
  const statusMsg = document.getElementById('status-msg');
  const resultsArea = document.getElementById('results-area');

  if (!fromStr) {
    alert('「置換前」の文字列を入力してください。');
    return;
  }
  if (fromStr === toStr) {
    alert('「置換前」と「置換後」が同じです。');
    return;
  }

  const tree = await chrome.bookmarks.getTree();
  const allBookmarks = getAllBookmarks(tree[0]);

  const targets = allBookmarks
    .filter(b => b.url && b.url.includes(fromStr))
    .map(b => ({
      id: b.id,
      title: b.title,
      oldUrl: b.url,
      newUrl: b.url.split(fromStr).join(toStr)
    }))
    .filter(item => item.oldUrl !== item.newUrl);

  resultsArea.innerHTML = '';

  if (targets.length === 0) {
    statusMsg.textContent = `「${fromStr}」を含む書き換え対象のブックマークは見つかりませんでした。`;
    return;
  }

  statusMsg.textContent = `置換候補: ${targets.length} 件見つかりました（変換しないものはチェックを外してください）。`;

  const panelDiv = document.createElement('div');
  panelDiv.className = 'group';

  let html = `
    <div style="margin-bottom: 10px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
      <button id="exec-replace-selected-btn" style="background-color: #6f42c1; color: white;">チェックした項目を一括置換</button>
      <span class="group-actions" style="margin-top: 0;">
        <a id="replace-select-all">すべて選択</a>
        <a id="replace-deselect-all">すべて解除</a>
      </span>
    </div>
  `;

  targets.forEach((item, idx) => {
    html += `
      <div class="item">
        <div class="item-info" style="flex-direction: column; align-items: flex-start; gap: 4px;">
          <div>
            <input type="checkbox" class="replace-target-chk" id="rep-chk-${idx}"
              data-id="${item.id}" data-new-url="${encodeURIComponent(item.newUrl)}" checked>
            <label for="rep-chk-${idx}"><strong>[${item.title || '無題'}]</strong></label>
          </div>
          <div class="meta" style="padding-left: 22px; word-break: break-all;">
            変更前: ${item.oldUrl}<br>
            変更後: <strong>${item.newUrl}</strong>
          </div>
        </div>
      </div>
    `;
  });

  panelDiv.innerHTML = html;
  resultsArea.appendChild(panelDiv);

  const checkboxes = panelDiv.querySelectorAll('.replace-target-chk');
  panelDiv.querySelector('#replace-select-all').addEventListener('click', () => {
    checkboxes.forEach(cb => cb.checked = true);
  });
  panelDiv.querySelector('#replace-deselect-all').addEventListener('click', () => {
    checkboxes.forEach(cb => cb.checked = false);
  });

  // チェックされたものだけを実際に更新
  panelDiv.querySelector('#exec-replace-selected-btn').addEventListener('click', async () => {
    const checked = Array.from(checkboxes).filter(cb => cb.checked);
    if (checked.length === 0) {
      alert('置換する項目がチェックされていません。');
      return;
    }

    if (!confirm(`チェックされた ${checked.length} 件のブックマークURLを置換しますか？\n実行前のバックアップをおすすめします。`)) {
      return;
    }

    statusMsg.textContent = '選択されたURLを置換中...';
    let updatedCount = 0;

    for (const cb of checked) {
      const id = cb.dataset.id;
      const newUrl = decodeURIComponent(cb.dataset.newUrl);
      try {
        await chrome.bookmarks.update(id, { url: newUrl });
        updatedCount++;
      } catch (e) {
        console.error(`置換失敗 (ID: ${id}, URL: ${newUrl}):`, e);
      }
    }

    statusMsg.textContent = `URL置換完了: ${updatedCount} 件のURLを更新しました。`;
    alert(`${updatedCount} 件のブックマークURLを置換しました！`);
    runScan();
  });
});