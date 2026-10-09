# 原生只傳圖片實測（2026-10-09）

## 授權與範圍
使用者要求以便宜模型實測 Claude Code 與 Google，允許少量消耗，不使用 Opus 5.5。只送新建假圖，不送工作圖片、不修改 K 產品、不部署／重啟／push、不換帳號、憑證或計費路徑。

## 實際結果
- 假图 picture.png：白底、左側紅方形、右側藍圓形、文字 PIC-7429，2304 bytes，SHA-256 644ac6c2eecf3a598f2aa9b2974668c2a85cf862159bd75ae939181e51b32d2b。代碼與圖形沒有放入文字提示。
- Claude Code 2.1.294：真正 claude-haiku-4-5-20251001、原生 Claude.ai Pro。使用者 content 只有一個 image/base64 區塊，沒有 text 區塊，工具清單空；原生完成成功、exit 0、is_error=false，回覆正確辨認 PIC-7429、red square、blue circle。Session 2903685e-1624-4951-982b-250222273198，僅一個模型回合，沒有工具／子代理。證明原生協定可收純圖片；不是只確認能貼圖。
- Antigravity CLI 1.3.1：第一次傳入相同 image 區塊，原生直接拒絕 `stream input content block type "image" is not supported (only "text")`，exit 1、num_turns=0、tokens=0。Session aa8e8c71-94ff-4c71-8a8b-bfa707e0a7d6。這是入口能力限制，不是模型不會看圖。
- 因上述明確新證據，第二個 Google 測試改傳唯一文字內容 `@D:/K-harness/.runtime/image-only-probe-20261009/workspace/picture.png`，沒有提問或圖形／代碼描述。原生 init 確認 gemini-3.8-flash-low；原生 view_file 成功讀取該圖，回覆正確辨認紅色正方形、藍色圓形、PIC-7429。Session 59cb8a98-97e0-402f-a5fb-b96216bc0462、SUCCESS、exit 0、一個模型回合，僅 view_file 工具；沒有重送失敗的 image payload、升級模型或帳號切換。
- 原生 Google 互動式貼圖後完全無文字按送出未實測；不能把上述檔案參照方式宣稱為 image 區塊直接傳送成功。對 K 人類介面而言，不填說明、只附圖可由既有檔案參照接法支援，不需要 API 計費或改核心。

## 判斷與未修改項
K 現有共用介面和三家 controller 都要求 text.trim() 非空，因而在到達原生核心前拒絕附件-only。Claude 已證明可直接收純 image；Google 已證明僅圖檔參照可完成讀圖，需沿既有檔案入口，不硬塞不支援的 image 區塊。此次只是原生實測，尚未放寬 K 的前後端檢查，也未宣稱 K 端已驗收。

所有回合均沿原生訂閱；Claude 回傳的 total_cost_usd 是原生清單價估值，不宣稱為另扣 API 款。Google 未提供金額。兩次成功輸入的圖形／代碼均不在文字中，因此可排除只重述提示的假讀圖。

證據：D:\K-harness\.runtime\image-only-probe-20261009 下 probe.mjs、各模式 start/input/events/result/stderr 檔、claude-preflight.json。未清理或刪除任何既有檔案。Google 官方協定说明：[headless](https://antigravity.google/docs/cli/headless/)（串流僅 text）；[互動貼圖](https://antigravity.google/docs/cli/prompting/)。
