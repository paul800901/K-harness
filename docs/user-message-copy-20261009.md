# 使用者訊息一鍵複製（2026-10-09）

## 本人要求與確認

本人提供 K、Codex App 畫面，要求核對人類訊息是否應能複製，若缺少則修好。Codex 附圖第二張明確顯示使用者訊息旁「複製訊息」入口；K 第一／三張只有助理回覆下方「複製」，使用者文字可選取但沒有一鍵按鈕。K 原碼 UserMessage 不渲染 CopyFeedback，AssistantMessage 已使用它，直接根因是呈現缺口，不是剪貼簿權限故障。

只讀核對官方 Codex App [功能頁](https://developers.openai.com/codex/app/features)（現重導至 learn.chatgpt.com/docs/features）未取得此微介面的具體文字規格，沒有把泛用功能頁當作支援證据；以本人截圖及當前 K 原碼確認。未讀取 Codex 程式包、登入資訊或原生聊天內容，未讀或改 OS 剪貼簿。

## 最小修正

- `frontend/main.jsx`：正常使用者文字泡泡下新增一個既有 CopyFeedback，沿用成功／失敗／pending／重試與既有 message-actions 樣式。不新增剪貼簿權限、設定、API、服務或複製框架，也不修改後端、訊息紀錄、模型／帳號或傳送行為。
- 普通訊息複製原 text，空格、換行、Markdown 原文與完整連結保持不變；含附件的訊息只複製文字，純附件不顯示空白複製。
- 已有兩種非普通呈現需保留界線：discussionHandoff 複製顯示給人的 displayText，不帶隱藏模型交接上下文；回覆引用複製人類可讀的提問、引用來源與註解，不複製 internal source_message_id／JSON 格式標記。此局部六行提取函式僅對應現有三種顯示，不抽象新系統。
- worker-completion 系統事件沿既有 early return 不新增使用者複製；舊容量接續提示仍不暴露隱藏續行文字。助理的 CopyFeedback 未修改。

## 驗證與狀態

- `test/user-message-copy-ui-probe.mjs`：真實 built UI＋Playwright 假狀態／隔離剪貼簿 stub，Codex／Claude／Gemini × 暖色桌面1920／白色手機390／暗色手機390，共9案例通過。驗證原文 exact、引用／交接無內部上下文、純附件不空複製、工人不冒充使用者、助理不退化、失敗不假成功且可重試、busy時可複製、原訊息不改、無後端POST及pageerror。
- Clipboard stub只驗證向既有 navigator.clipboard.writeText 交付的 exact文字及UI狀態；沒有實際讀寫本人的 OS 剪貼簿，不能冒稱 Electron／原生剪貼簿新實測。既有 copy 元件與原生權限邊界未修改，另跑對應既有回歸。
- 建置通過；完整序列回歸1088/1088通過，無失敗／跳過。日誌留在 `D:\K-harness\.runtime\user-message-copy-20261009\full-test.log`，9案例UI結果在本工作樹 `.runtime/user-message-copy-ui/result.json`。
- 真正官方 Claude Code 2.1.294／`claude-opus-5-5` 訂閱只讀複查完成，session `a6213a5f-1959-467d-a368-16e1d3e800e8`、exit0／success，沒有阻斷項。Read／Glob／Grep限定，無Shell／寫入／瀏覽器／MCP；原文、packet、結果留在 `D:\K-harness\.runtime\user-message-copy-20261009\review`。複查時完整回歸尚未結束，該等待已由上述1088/1088結果解除；其引用packet中「複查未完成」是當時文件狀態，不是複查結果失敗。
- Astra獨立核對六行提取函式、按鈕條件、既有剪貼簿元件、diff／UI結果與桌面／手機截圖：最小根因修正，無後端／權限擴張。舊容量接續條件只有讀碼驗證，沒有新增UI實測；不為歷史提示再擴張修正。Opus建議的Electron原生剪貼簿實機確認仍未執行，不能將stub測試宣稱為正式剪貼簿讀回。
- 已驗證候選程式版本 `1a45a73440a5f948c5cec625de02340863b7c67d`；本段只更新工程文件，不改已複查程式。正式部署尚未執行。
- 正式 K 目前仍監聽47831（pid35988），本人截圖也顯示某聊天室工作狀態，不能以先前「沒有工作／已關閉」推斷現在可更新。不關閉、停止、重送或切換本人聊天室；先停在已驗證候選，等明確停止或可驗證正式閒置後才沿既有版本流程更新。本批不push／更新東區。
- 起點是最新正式 `3bcdde04f8040e1e2777c276025ee980ec421d20` 加其文件收尾 `9447397`，保留已部署額度、附件-only、排序／插話等變更，不以舊根工作樹覆寫正式版。
