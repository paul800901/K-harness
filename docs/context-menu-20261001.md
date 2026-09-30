# K 原生右鍵編輯選單與介面接線回查（2026-10-01）

## 根因與修正
正式 Electron workbench 沒有監聽 context-menu，快捷鍵可用但右鍵沒有選單。只在 src/electron-workbench.mjs 增加視窗層事件：可編輯欄位提供復原／重做／剪下／複製／貼上／全選，非編輯區選取文字則提供複製，無選取的空白區不冒出無關項目。啟用狀態沿用 Chromium editFlags，動作直接用原 webContents 的原生編輯方法。沒有新增 clipboard 讀取權限、IPC、前端自製選單或套件。

官方 API 參照：https://www.electronjs.org/docs/latest/api/web-contents#event-context-menu

## 實際驗證
- 真正 BaseWindow／WebContentsView、正式 createElectronWorkbench、原生右鍵輸入事件及 Menu 項目，使用本機假頁面：複製、貼上不清除原稿、剪下、復原、選取回應文字複製均通過。
- 測試攔截 popup 以程式呼叫原生 MenuItem click，不是人工點選作業系統選單；正式外觀尚待使用者右鍵確認。測試剪貼簿原內容僅在記憶體保存並於 finally 還原，未輸出內容。
- 初次 fixture 使用舊 Electron clipboard API 失敗；依已安裝 Electron 44 型別改為 async read/write。後續事件等待失敗是測試 mouse input 缺少 clickCount／移動事件；補齊後觸發成功。貼上斷言另改為右鍵實際游標位置，未為測試改產品行為。
- 完整測試 **502/502**。建置 UI 模型選單行為 probe 通過。未呼叫模型、未開真網站。

## 使用者追加的其他介面回查
- 搜尋前端所有 button 接線：沒有 onClick 的三個按鈕（重新命名儲存、送出回答、儲存目標）皆在對應 onSubmit 表單內，不是漏接。
- sidebar 的開啟、排序、釘選、封存，設定的外觀／封存管理／停止，引用與語音控制可見對應事件；preload 提供的 onWindowHidden 與目前語音引用相符，未找到第二個確定斷路。不宣稱全部按鈕都已在真帳號情境實測。
- conversation-navigation、attachment-label 兩支舊 UI probe 指定的 Chromium-1246 不在目前 worktree，未執行成功；本輪沒有下載套件或順手改這些舊測試。
- 本修正適用 K owner view 的一般文字欄位／文字選取。外部 Chrome 的原生右鍵本來由 Chrome 負責，不在本次修改範圍。

## 正式部署
待補讀回；只需更新一個 Electron 模組，前端資產、對話與登入不動。
