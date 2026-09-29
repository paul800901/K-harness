# 瀏覽器取消與登入隔離審查接續（2026-09-25）

## 本輪使用者決定
使用者同意「先修取消，隔離方案另行確認」。正式瀏覽器維持關閉，不重啟正式後端，不使用真實帳號，不搬移既有 profile，也不修改 Windows 權限。

## 已知證據與界線
- Opus 已記錄 Claude／Codex 各一次原生同頁讀取、接手、交回後讀回成功；此為服務與 proxy 路徑，並非 React 面板與模型整合實測。原證據見 opus-review-browser-live-view-20260925.md，本輪不重跑付費回合。
- MCP 取消通知或 client 逾時不等於正在進行的網頁操作已停止。不能只把計數減一就允許人工接手；未確認的動作不得自動重送。
- profile/live.json 與 cookie 位於模型可能讀取的目錄，問題尚未解決。移到 LOCALAPPDATA、Windows 上的 mode:0o600、僅增加 Read deny，均不足以隔離同一 Windows 使用者下具 shell／完整存取權的模型。
- 程序間傳遞可減少 token 落地，但本身不保證防止同權限程序取得控制或讀取 cookie。完整隔離須另行設計並驗證模型與瀏覽器控制端的權限邊界；不在本輪自行建立帳號、服務或改變沙箱設定。

## 介面修正
frontend/browser-panel.jsx 常駐簡短警告：尚未隔離控制資料與登入資料，僅使用假資料，勿登入真實帳號或輸入密碼／驗證碼。移除原先可能誤導的「不會保存在 K／需登入時自行確認」文字，明示輸入可能出現在網頁、儲存與模型工具回應。
這是風險提示，不是技術隔離或登入封鎖。正式開關仍不存在，不能因警告已加上就宣稱可正式登入。

## 取消修正與驗證
- src/browser-mcp-stdio.mjs 接收 active request 的 notifications/cancelled，先把工作階段設為不可用並關閉 browser context；等關閉完成才釋放該呼叫計數。取消回覆晚到也不提前放行。
- src/browser-live-session.mjs 新增 failClosed：保留已認證的狀態端點回報不可用，不讓面板永久等候；明確提示重新開啟對話以重連，不自動重送先前操作。此修法會結束該瀏覽器工作階段，不是假裝在原頁安全繼續。
- 關閉未成功時仍禁止 AI／人工操作，不以逾時強行解鎖。
- test/browser-live-session.test.mjs 驗證关闭尚未完成時的互斥；test/browser-mcp-boundary.test.mjs 經真實 MCP 開啟空白 Edge、snapshot，執行 browser_wait_for(30)，確認 available+busy 後用 AbortSignal 取消；讀回 unavailable 且 busy=false。僅空白頁、無網站／帳號／模型額度。
- 主代理補強原測試，要求取消前真實 browser context 已 available，避免只測到未開瀏覽器的等待計數。定向 7/7 通過。SDK 逾時會送同一取消通知路徑，但未另做原生 Claude／Codex 使用者停止按鈕實測。


## 本輪新增：右側寬幅工作區（使用者截圖要求）
- frontend/main.jsx、style.css、browser-panel.css：桌面預設聊天／工作面板平分剩餘寬度；可拖曳或用方向鍵調整，窄視窗使用覆蓋面板；分頁、＋、收合同一列，分頁可橫向捲動而＋保持可見。
- 根因包含舊 --inspector-width:316px 覆蓋新 fallback，及舊分頁 overflow 規則。已明確設定預設 1fr，清掉重複面板 CSS。
- 主代理驗收補修：分頁最小 120px、列高 48px；瀏覽器填滿規則限定 browser slot，不改成果卡片排版；快照保持原寬高比，避免 object-fit 留白使點擊換算偏移。
- CUA 在隔離 47845 UI 驗證新增瀏覽器、選單完整、等寬分割、方向鍵調宽、窄視窗無水平溢出、本機 47846 網頁實際顯示。寬螢幕讀回：聊天／工作面板各 589.47 CSS px；快照 563.94×422.96 對應原圖 1024×768。尺寸受既有顯示縮放影響。拖曳事件已有實作，本輪互動驗收用鍵盤調寬，沒有宣稱實際拖曳或模型＋UI 整合全驗收。

## 最終驗證與正式狀態
- npm test：321/321 通過，0 失敗，記錄 .runtime/browser-cancel-ui-tests-20260925.log。
- 最後 UI 建置成功，保留既有大 bundle 提醒；介面修改另經上述 CUA readback。
- 正式 .runtime/browser-mcp.json 仍不存在；沒有重啟正式後端。建置可能供既有服務在重新整理時讀取新前端，不代表後端取消修正已正式載入。
- 隔離驗收頁已關閉、視窗尺寸覆寫還原、測試服務已停止。不刪除假資料或既有紀錄。
- 下一輪 Opus 可直接讀本文件與差異，核對取消後安全不可用／重連提示以及版面；不必重跑之前付費同頁驗收。安全隔離未解決前不得以此輪完成宣稱可使用真實登入。
