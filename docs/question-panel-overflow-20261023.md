# 提問面板超出畫面無法送出（2026-10-23）

## 問題

本人在 CaseAgent「交接」聊天室收到 Claude 的三題提問（第一題四個多選＋K 補的 Other）。桌面版提問區被撐出視窗，第三題與「送出回答」按鈕被切掉，無法送出，聊天室卡在待確認。

## 原因

1. `frontend/style.css` 的 `.inline-requests` 桌面版沒有高度上限；手機版（`mobile.css`）已有 `max-height:35dvh`，桌面版漏了。
2. `frontend/model-picker.css` 的多選選項樣式（`.claude-question-options label/input`）特異度低於通用的 `.approval-card form label{display:block;margin:15px 0}` 與 `.approval-card input{width:100%}`，勾選框被撐成整行置中、每個選項變很高，使溢出更嚴重。

## 修正

- `.inline-requests` 加 `max-height:55dvh;overflow:auto;overscroll-behavior:contain`，超出時在提問區內捲動。手機版的 35dvh 仍以媒體查詢覆蓋。
- 多選選項規則改為 `.approval-card .claude-question-options …`，恢復勾選框在左、文字在右的緊湊排版（`margin:0`、`width:auto`）。

程式 commit：`c2544753ea44d553a8a98e4134dc0c595b7b4525`（分支 `fix/question-panel-overflow`）。

## 驗證

- `npm ci`（主工作樹 `node_modules` 為空，依 lockfile 還原）後 `npm run build:ui`、`npm run test:ui` 50/50。
- `npm test` 1821/1821。
- 未新增專屬 UI 探測；未在正式 K 實機目視。

## 當下處置

本機 API 有工作階段 Cookie 保護，AI 不繞過，未替本人送出。改由主代理從原生紀錄讀出完整三題，本人在另一聊天室作答，整理成文字讓本人以鍵盤 Tab 送出或停止後以一般訊息送出。

## 複查與部署

- 主代理為 Opus 5.5，CSS 兩行修改自查；未另派 Fable 第二審（改動範圍小）。
- 尚未部署：K 內的 AI 無法更新自己所在的 K，須本人完全關閉 K 後在 K 外執行 `Update-K.ps1`。部署完成前不 push。
- 東區未更新。
