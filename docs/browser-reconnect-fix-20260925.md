# Codex 取消後原對話重連（2026-09-25）

## 本輪問題與實測
Opus 第五節指出：MCP 工作階段安全關閉後，僅 thread/resume 是否足以重建瀏覽器未知。

主代理使用 scripts/browser-reconnect-probe.mjs，恢復 Opus 先前的隔離測試對話，沒有 turn/start、沒有模型推論、沒有正式啟用、沒有真網站或登入。
- 同一 app-server 連續 resume：控制 token 不變，證實仍沿用原 MCP 程序，不能宣稱能恢復取消後已關閉的工作階段。
- 關閉該隔離 app-server，建立新的 app-server 再 resume 同一 thread：token 改變。
- 新 MCP 的人工接手啟動真實空白 Edge，讀回 available=true、human、不忙碌。
- 不输出 token；證據僅記是否更換。證據：.runtime/browser-reconnect-probe/b3b6f9ed-9797-451b-af2c-b321e41e4af7/evidence.json。
- 這是原生生命週期證據，不是模型 UI 中點停止→重開的完整人工驗收。取消本身沿用前輪真實 MCP 長等待中取消測試。

## 修法
由 K 在原對話重新開啟時辨識明確 recoveryRequired 狀態，再經原有停止／子代理檢查後，重建自己的原生 host 並恢復歷史。不把從未開啟瀏覽器、未準備好或暫時查詢失敗誤判為可直接重啟。
不得中斷其他 Codex App 工作，不自動重送任何 turn 或網頁操作。若仍有未確認子代理，不進行恢復。

## 狀態
已完成控制器恢復流程與 31 項控制器測試；本輪完整 325 項測試通過。原生隔離讀回如上，未宣稱正式上線。正式開關仍關閉，控制 token／cookie 的權限隔離另案處理，不允許真實登入。

## 使用者新增的介面方向
瀏覽器上方採正常工具列：網址、上一頁、下一頁、重新載入、下載。沿用 Playwright 的 page.goBack/goForward/reload 與 download 事件，不重造瀏覽器核心；下載需另外接保存及清單。
使用者明確排除擴充功能。網址與下載的實作、驗收見 browser-toolbar-downloads-20260925.md。密碼管理、cookie 匯入及帳號功能先等隔離設計，不因 UI 複製而擴張授權。
來源： https://playwright.dev/docs/api/class-page 、 https://playwright.dev/docs/downloads 、 https://playwright.dev/docs/chrome-extensions 。
