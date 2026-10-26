# Claude 聊天室從指定結論原生分支

記錄於 2026-10-26。

## 起因

本人問「Claude 原生不能分支？」。原本分支對話框寫「Claude 同供應商只支援最新結論」，從較早結論分支時 Claude 選項停用。查證後這是 K 沒接上，不是 Claude 做不到：K 只用 `--resume <來源> --fork-session`，只能整段複製到最新。本人同意：「截回原生的能力……到時候再測試它可不可以用。」

## 原生依據

從 K 使用的 `trusted-providers/claude.exe` 讀出的原生說明：

> `--resume-session-at <message id>`：When resuming, only messages up to and including the chain entry with <message.id> — any chain-entry UUID, typically the kept turn's last entry (use with --resume in print mode)

- 缺 `--resume` 時原生報錯 `--resume-session-at requires --resume`；非 print 模式會忽略。K 本來就以 `--print` stream-json 啟動 Claude。
- 官方 Agent SDK 對應 `resumeSessionAt`，產生順序為 `--fork-session`、`--resume-session-at=<uuid>`、`--session-id=<id>`。
- 這是 `--help` 不列出的參數。另有 `--resume-drops-turn`（只核驗丟棄單一回合），本功能要丟的是多個後續回合，不使用。

## 差異

- `src/claude-controller.mjs`
  - 助理訊息有文字時記下原生 envelope UUID（`nativeUuid`）。K 訊息 id 通常是 `claude-stream-<API message id>`，不是原生要的 UUID；同一則 API 訊息多個文字區塊時留最後一個，thinking／純工具區塊不覆寫。隨對話保存與重開還原。
  - `fork()`：可指定任一已完成的助理結論。最新結論照舊整段分支；較早結論需有 `nativeUuid`，否則回「這則結論是較早版本留下的紀錄，沒有原生訊息位置；請從最新結論分支，或改用跨供應商交接。」
  - `open()` 截斷分支：K 的訊息投影截到該結論（找不到就報錯、不建立）；工具紀錄保留同群組且時間不晚於該結論者（原生背景後續回合沿用結論的群組，只看群組會留下結論之後的工具）；壓縮次數標未知。成果清單照舊全部繼承，因為檔案實際仍在工作區。
  - 分支建立失敗時恢復原對話畫面（原本只有取消時恢復，一般失敗會停在一個沒建立的新對話 ID），與取消時同樣標「已中斷」。
- `src/claude-host.mjs`：有截斷位置時加 `--resume-session-at <uuid>`，需同時有來源且為 8-4-4-4-12 格式。
- `frontend/main.jsx`、`frontend/dialogs.jsx`：Claude 來源的結論若是最新或有原生位置，就可選 Claude 同供應商分支；說明文字改寫。modal 欄位 `isLatestConclusion` 改名 `claudeNativeFork`。
- 測試：`test/claude-controller.test.mjs` 新增 4 項（較早結論截斷、舊紀錄拒絕、最新結論不帶截斷、串流 id 與原生 UUID 不同＋重開後分支＋背景工具截斷＋失敗恢復）；`test/claude-host.test.mjs` 新增 1 項（參數組裝與格式檢查）。

## 限制

- 本版之前產生的 Claude 回覆沒有原生位置，只能從最新結論分支；部署後的新回覆才能從任一結論分支。
- 原生是否接受所有記下的 UUID（例如 synthetic 錯誤訊息、壓縮之前的位置）尚未實測，未驗證，不代表一定失敗。

## 驗證

- `node --test test/claude-controller.test.mjs test/claude-host.test.mjs`：162/162。
- `npm test`：1961/1961。
- `npm run build:ui`、`npm run test:ui`：51/51（工作樹以 junction 連到主工作樹 `.runtime/playwright-browsers`）。
- 未在真實 Claude Code 上實測截斷分支；本人同意部署後再測。

## 分工與複查

- Opus 5.5（本聊天室）查證原生參數、寫規格、逐行複查並修改。
- Gemini 3.8 Flash 實作初版。Opus 複查後改了三處：截斷點找不到時改為報錯（原本默默保留整段，會和原生歷史不一致）、刪掉多餘的 `forkAtMessageId` 參數、前端拿掉多餘的結論推算（分支按鈕本來只出現在結論上）。
- GPT-6.1 Sol 只讀複查：必修 2 項（背景工具截斷、分支失敗未恢復）已修；建議 3 項中補測試與嚴格 UUID 格式已做，成果清單繼承維持現狀（理由見上）；確認不需 `--resume-drops-turn`、保存還原正確。Sol 未修改程式。

## 部署狀態

未部署。

## 未完成事項

1. 部署後在正式 K 實測：Claude 聊天室聊幾輪，從較早結論分支，確認新對話只保留到該結論、原對話不受影響、新對話能正常續聊。
2. `--resume-session-at` 是隱藏參數；三家核心更新 Claude Code 後需重跑上面實測。
