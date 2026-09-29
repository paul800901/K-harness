# 輸入框寬度、高度與模型簡稱（2026-09-26）

## 範圍與差異

- `frontend/style.css`：第 85 行的通用 `min-width:0;max-width:100%` 保留，避免窄窗內容撐破主畫面；其後重新指定 `.message-column{max-width:720px}` 與 `.composer-area{max-width:768px}`。後者含左右各 24px 內距，因此輸入卡片可見寬度上限為 720px，與訊息欄一致。空白首頁與對話共用此規則。
- `frontend/style.css`：收緊 `.composer-card` 內距與 `.composer-input` 上下內距，最小高度由 `3.2` 倍字級改為 `2.8` 倍；不改多行自動增高的元件設定。
- `frontend/main.jsx`：保留原 `modelName` 的完整「模型 · 供應商訂閱」字串，供側欄、搜尋、模型切換訊息及輸入框按鈕的滑鼠提示使用；只讓輸入框按鈕以 `modelButtonLabel` 顯示簡稱。例如 Claude Opus 5.5 → Opus 5.5，GPT-6 Sol 維持 GPT-6 Sol。
- 未改側欄、權限、送出、麥克風、附件的行為；右側聊天室外層圓角卡片保留。沒有新套件或後端程式修改。

## 測試與正式畫面讀回

- 首輪預設並行 `npm test` 為 485/487，兩項 `claude-controller` 非同步測試失敗；本輪未修改該模組，確切失敗原因未釐清，不掩蓋初次結果。之後循序完整測試 `node --test --test-concurrency=1 test/*.test.mjs` 由 Luna 與 Astra 各跑一次，皆 **487/487**；`test/ui-style-guard.test.mjs` 為 3/3。最後獨立全套紀錄：`D:\K-harness\.runtime\composer-layout-20260926\full-test-final.log`。最後建置 `npm run build:ui` 成功，僅既有大型 chunk 警告；紀錄為同目錄 `build-final.log`，建置首頁與正式首頁 SHA-256 一致。
- 正式 Chrome 頁面 1920×953：輸入卡片與訊息欄各約 792 畫面像素，對應 110% 縮放下的 720 CSS px；兩者中心差約 5 畫面像素，來自訊息區的捲軸。模型按鈕顯示 `Opus 5.5`，`title` 仍為 `Claude Opus 5.5 · Claude 訂閱`。
- 1000×850：空白首頁輸入卡片與訊息欄同寬、同起點，頁面 `scrollWidth=1000`；有對話時卡片與訊息欄左緣相同，寬度相差約 10 畫面像素（訊息區捲軸），`scrollWidth=1000`，輸入框沒有被容器裁切。為檢查聊天區，1000px 有對話截圖先收起既有「成果」面板；展開時它仍會依原設計覆在聊天區上，本輪不改該面板。
- 對話中的未送出五行文字使輸入區由約 68px 自動增至 158px，清空後回到約 68px；沒有送出模型回合。原空白卡片約 143.9px，最後版本約 130.7px（均為 110% 縮放畫面量測）。

| 正式 K 畫面 | 截圖路徑 |
| --- | --- |
| 空白首頁，1920×953 | `D:\K-harness\.runtime\composer-layout-20260926\formal-home-1920.png` |
| 空白首頁，1000×850 | `D:\K-harness\.runtime\composer-layout-20260926\formal-home-1000.png` |
| 既有對話，1920×953 | `D:\K-harness\.runtime\composer-layout-20260926\formal-conversation-1920-after-restart.png` |
| 既有對話，1000×850 | `D:\K-harness\.runtime\composer-layout-20260926\formal-conversation-1000-after-restart-aligned.png` |

## 正式部署與還原

- 14:56 首次複製建置資產後，正式 DOM 讀回發現輸入區仍採舊 padding：當時建置早於最後的 padding 修改。14:58 重新建置並核對新 CSS 確實包含 `padding:0 4px 8px`，再將最後 JS/CSS 複製到正式隔離版 `trusted-runtime/dist-ui/assets`，最後切換 `index.html`。中間版與原版首頁均保留，未刪舊資產。
- 部署前正式畫面只有一個已完成對話，沒有停止工作按鈕、核准卡、待送訊息或草稿。定點結束閒置系統匣父程序後，其私有 stdin EOF 觸發隔離 supervisor 的關閉路徑；讀回舊 supervisor 已退出、47831 監聽消失，才使用既有 `Start-K-Desktop.ps1` 啟動。未強制結束 supervisor 或模型程序；此次沒有取得私有 `closed` 回覆，不把程序退出冒稱該回覆。
- 15:01 正式 47831 重啟後 `/health` 回報 `deployment=isolated`、原 private-state 工作區；新啟動器 PID 25188、supervisor PID 31832。官方入口新開的正式 Chrome 分頁先顯示空白首頁，切回既有 Claude 對話後原訊息仍可讀，未重送或新增回合。頁面讀回最後資產 `index-CfAeBlYS.js` 與 `index-B_s-wLcO.css`，外層卡片圓角仍在。
- 最終正式首頁 SHA-256：`2367AFDB49F91923EDE844B0273D41A677DA315076C477F6BAFC81EE0EE39220`。部署收據：`D:\K-harness\.runtime\composer-layout-20260926\deployment-final.json`。原首頁備份：`D:\K-harness\.runtime\composer-layout-20260926\formal-index-before.html`；舊資產仍保留。若需回復，須先確認當時工作狀態，再將備份首頁還原到正式 `trusted-runtime/dist-ui/index.html` 並重新載入頁面；本輪未執行回復。

## 限制

此輪是前端外觀修正；未重新驗證不同模型的實際送出、麥克風或附件功能。1000px 畫面檢查針對聊天區在成果面板收起時的寬度與不溢出；既有面板展開覆蓋行為不屬本輪修改。
