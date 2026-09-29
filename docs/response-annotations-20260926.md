# 助理回覆引用與逐段註解

日期：2026-09-26。初次實作紀錄如下；後續已完成候選 UI 多段選取、切室保留、真實 Claude 回覆及人類歷史收合顯示，詳見[整批收尾](closeout-20260926.md)。實際麥克風辨識仍未驗證，部署以該總表為準。

## 使用方式

- 在單一完整的助理回覆內反白文字，按「加入聊天」；工具紀錄、其他聊天室、尚在串流的回覆不提供引用。
- composer 顯示多段引用，每段保留來源助理 message id（有值時）、精確選取文字與可分別編輯的「我的註解／要求」；可刪除任一段。引用草稿以 thread id 分別存在 sessionStorage，切換聊天室不串用。
- 可在每段註解欄使用聽寫，沿用 `useVoiceComposer`／`WebSpeechDictationAdapter` 與既有同意狀態；聽寫文字插入至啟動聽寫時保留的註解游標位置。主輸入框與各引用卡共用單一聽寫擁有者；送出控制在錄音／轉錄期間停用，避免遺失尚未完成的結果。刪除引用、切換聊天室會取消所屬收音，不會轉填到其他註解。未做真麥克風測試；沿用既有瀏覽器聽寫，音訊處理方式依瀏覽器供應商，不宣稱離線。
- 送出時將引用打包為普通 user text 中的 `k-response-annotations-v1` JSON，保留 quote 原文、source message id 與 annotation 欄位；前置文字明示 quote 是上下文，只有 annotation 是使用者要求。沒有移植 Codex 私有註解協定，Claude/Codex 都收到一般文字訊息。
- 聊天歷史只解析自身完整且明確的 `k-response-annotations-v1` 信封；顯示使用者原文字，以及收合的引用段落／註解，不展示 JSON 或來源 ID。一般 JSON／外部格式仍依原樣顯示；模型收到的送出 payload 不變。
- 先行檢查 JSON request UTF-8 大小，超過 60 KiB 會走送出錯誤保留路徑，不清掉 composer 草稿，並提示縮短；附件仍在讀取時同樣拒絕送出，不清掉草稿。每則最多 8 段、單段最多 12,000 字元。API 失敗時引用草稿留在來源聊天室，輸入文字依既有 `k-draft:<threadId>` 邏輯保存；成功只清除與送出時完全相同、未在等待期間被修改的引用，保留後續編輯或新加的引用。

## 其他 UI 收尾

- 有原生 plan 時，在 composer 上方顯示可摺疊「工作進度 x/n」，展開列出待處理／進行中／已完成；無 plan 時不顯示。Claude `in_progress` 摘要優先用 `activeForm`。
- Approval 的 `q.text` 加上 `white-space: pre-wrap`，保留 ExitPlanMode 原生計畫換行。未把舊 ProgressPanel／能力表或 token 面板接回主介面。

## 驗證與限制

- `node --test test/response-annotations.test.mjs test/dictation-session.test.mjs`：16/16 通過，含房間草稿隔離、段落編號、失敗送出後草稿恢復、來源識別、JSON 上下文/要求區分、UTF-8 body 上限、游標插入、mock dictation 跨房間寫入保護及既有聽寫 session 測試。
- Vite UI build 到隔離輸出 `frontend/.runtime/response-annotations-build` 通過；未寫入正式 `dist-ui`。有既有 chunk 大小提示，build 成功。
- 未做完整 `npm test` 前，回歸狀態為未確認；未做真實 provider、候選 UI、鍵盤／滑鼠互動、room switch during live microphone 或真麥克風驗收。候選 UI build／部署待主代理統一執行。
