# 圓桌面板：焦點框被切斷（2026-10-27）

## 起因

圓桌按鈕批（`18b0fe3`）部署後，本人截圖指出右上角「討論場次」選單被點選時，棕色外框上緣被截斷，並提醒「修的時候要注意這種 UI 狀況」。

根因：全站焦點框是 `:focus-visible{outline:2px solid var(--k-brass);outline-offset:2px}`，畫在元件外 4px。`.discussion-roundtable` 設 `overflow:hidden` 且沒有內距，貼邊的選單、停止鈕、整理收合標題、閱讀鈕的焦點框因此被裁掉。問題在按鈕批之前就存在；按鈕批驗收時只看靜止截圖，沒有檢查焦點狀態，所以漏掉。

## 修改

- `frontend/discussion-roundtable.css`：`.discussion-roundtable` 加 `padding:4px`，剛好容納焦點框。全站 `border-box`，不會多出捲軸。
- `test/discussion-roundtable-ui-probe.mjs`：新增 `checkFocusRoom`，在窄版卡片與手機兩種版面，用幾何檢查標題列選單／按鈕、整理收合標題、閱讀鈕、手機批次選單外擴 4px（依介面縮放）後仍在圓桌邊界內。

## 驗證

- 新檢查在修改前程式上失敗（`focus rings must not be clipped at the roundtable edge`），修改後通過；圓桌實測 5/5。
- 另以暫時複本讓選單顯示焦點框截圖，人工檢視四邊完整（暫時檔已刪）。
- 完整 `npm test` 2007/2007。
- 完整 `npm run test:ui` 第一輪 52/53：唯一失敗 `mobile-remote-ui-probe`（不碰圓桌）；單獨重跑 3 次 2 過 1 失敗，與 [巢狀派工](claude-nested-delegation-20261024.md)、[聽寫預熱](dictation-prewarm-20261023.md) 等已記錄的整批偶發相同，未改測試。第二輪同一輪 **53/53**。
- 程式 commit `564a567`（完整 `564a567058e61256ce3b1f90ca1b086dbec186b5`）。

## 複查

主代理（Opus 5.5）撰寫與複查；一行 CSS 與測試，沒有 GPT 撰寫的程式。

## 部署

合回 `main` 後寫 `.local/update-ready.json`，待本人按「更新」。

## 未完成

- 只處理圓桌面板。K 其他 `overflow` 容器邊緣的焦點框尚未逐一盤點。
- 東區未更新。
