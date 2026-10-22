# 新對話預設最高權限（2026-10-22）

## 本人要求

2026-10-22 本人原話（摘要）：新增對話時，三家核心都預設成最高權限。本人知道各家原生預設不是這樣，但 K 只給本人用，習慣平常都開最高權限、有問題才降，不要每次都去調。

## 差異

- 新對話視窗（電腦與手機共用 `frontend/model-picker.jsx`）的「操作權限」預設：
  - GPT：要求核准 → **完整存取權**（`danger-full-access`）
  - Claude：手動核准 → **略過權限提示**（`claude-bypassPermissions`）
  - Gemini：工作區編輯 → **完整存取權**（`danger-full-access`）
  - 自架：維持**要求核准**。本人只要求三家核心；自架 auto-review 尚未驗證，且自架模型可能是未審查版本，不一併提高。
- 預設值本身視為本人確認：送出時若選的就是該提供者的預設，`permissionConfirmed` 送 `true`。所以在選單裡再點一次已選中的最高權限不會被後端拒絕；改選**預設以外**的高權限（例如 GPT 的代我核准、Claude 的自動接受編輯／Auto）仍照舊跳確認。
- 未改：後端建立／切換／分支時的 `permissionConfirmed` 檢查、舊對話權限、分支視窗（同提供者沿用原房權限，跨提供者仍須明確選）、聊天室內切換權限、子代理權限上限規則（Claude bypass／Codex full access 時子代理核准由主代理決定，沿用既有規則）。
- `AGENTS.md` 第四節同步改寫現行規則；舊規則原文保留在 `docs/agents-history-20261013.md`。

## 檔案

- `frontend/model-picker.jsx`：`providerDefaultPermission` 改為各提供者最高權限（自架除外）；初始權限改由同一函式取得；建立時預設即確認。
- `test/model-picker-ui-probe.mjs`、`test/new-dialog-fast-ui-probe.mjs`、`test/model-picker-compact-ui-probe.mjs`：預期值改為新預設，並加驗「再點一次預設最高權限不跳確認、送出仍為已確認」。`test/selfhost-ui-probe.mjs` 原有「自架預設要求核准」斷言不變，正好守住自架不提高。

## 驗證

- 工作樹 `C:\Users\Paulus\.codex\worktrees\new-room-full-access\K-harness`，分支 `claude/new-room-full-access-20261022`，依 lockfile `npm ci`。
- `npm test`：**1821/1821**（約 72 秒）。第一次在建置介面前執行有 2 項因缺 `dist-ui/index.html` 失敗，屬執行順序問題，建置後重跑全過。
- `npm run build:ui` 後 `npm run test:ui`：同一輪 **50/50**。工作樹不在 `D:\K-harness` 底下，第一次找不到 Playwright 瀏覽器（1/50，未真正執行）；以 `PLAYWRIGHT_BROWSERS_PATH` 指向 `D:\K-harness\.runtime\playwright-browsers` 重跑後全過，含 `model-picker-ui-probe`、`model-picker-compact-ui-probe`、`new-dialog-fast-ui-probe`、`selfhost-ui-probe`。
- 程式 commit：`62b7190b18f5a2970156b274904f532ec5966173`。

## 複查

- 主代理即真正 Opus 5.5（Claude Code 訂閱），實作與複查同一人；本批不是 GPT 寫的程式。改動約 10 行，未另派 Fable 第二審。
- 自查重點：只動前端預設、不碰後端確認檢查（避免讓 AI 經工具建立高權限對話時繞過確認）；手機遠端沒有另外的權限白名單，新預設在手機上同樣可建立；切換模型視窗不送權限，不受影響。

## 部署狀態

- 未部署。本批是權限預設變更，依專案規則停在部署前交本人決定；且本次 AI 在正式 K 內執行，無法更新自己所在的 K，須 K 完全停止後在 K 外執行 `Update-K.ps1`，部署目標為上列程式 commit 完整 SHA。
- 已 fast-forward 合回本機 `main`；未 push（依流程部署後再 push）。東區未更新。

## 未完成事項

- 正式部署、部署後讀回與 push。
- 本人實際開新對話確認三家預設顯示為最高權限、自架仍為要求核准。
