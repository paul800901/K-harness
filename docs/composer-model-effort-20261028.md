# 聊天室常駐模型與推理程度（2026-10-28）

## 問題與修正

本人提供三張畫面：既有 Claude Fable 5.1 聊天室的輸入列只顯示模型，要打開「切換主代理模型」才看到推理程度「最高」；新 GPT 聊天室則可直接看到模型與「沿用設定（極高）」。

- `frontend/main.jsx`：Claude 的既有模型按鈕直接顯示「Fable 5.1 · 最高」，提示文字帶完整模型、來源與推理程度。手機沿用「對話設定」按鈕，分兩行顯示模型與推理程度。
- `frontend/mobile.css`：手機僅模型名稱可省略，推理程度另列；較長強度名稱可換行，保留全文以及設定、權限、附件與送出按鈕。
- 讀值沿用原有設定：Claude 與執行中的工作讀 `state.effort`；其他核心閒置時顯示既有推理選單的草稿值，未指定時沿用保存值。沒有具體值但目錄提供推理選項時顯示「原生預設」，不把預設猜成某個強度；沒有推理設定的模型不補造強度。
- 未改模型／推理選擇、送出、保存、權限或核心協定。桌面 GPT／Gemini 沿用已有的獨立推理選單。

## 驗證

- 新增 `test/composer-model-effort-ui-probe.mjs`，以建置後介面、假 API／SSE 與獨立無頭瀏覽器驗證：Claude 顯示與設定視窗相符、執行中仍可讀、保存值更新、原生預設／無推理選項、切房替換、手機 GPT 草稿與執行中值、Gemini／自架、零工作送出與零頁面錯誤。
- 390px／320px 手機檢查推理文字完整、位於按鈕內、與送出區不重疊、頁面不橫向溢出。主代理已目視桌面與 320px 截圖。
- `npm run build:ui` 通過；既有單一產物大小警告仍在。針對性 UI 探針通過。
- 完整 `npm test`：2,014／2,014 通過。最後一次 `npm run build:ui` 後完整 `npm run test:ui`：同一輪 54／54 通過（`ui-test-final.log`），包含新增探針與原先截圖失敗的 modal-scroll。
- 第一輪 UI 53／54，`modal-scroll-ui-probe` 在第三組畫面截圖時報瀏覽器已關閉，前兩組及第三組截圖前斷言已通過；關閉根因未查明，原紀錄保留 `modal-scroll-first-failure.json`。最終 CSS 重建後，該測試獨立重跑通過，未修改或放寬該測試。最終模型強度探針含 GPT Ultra／原生預設也通過，主代理目視兩張 320px 截圖，長文字未裁切或壓到圖示。
- 探針開發時兩次失敗均為測試同步／初始畫面設定：未等待 React 套用 busy 狀態；桌面縮成手機後側欄仍開著擋住按鈕。分別補等待 DOM 與正常收合側欄，不改產品行為、不強制點擊。
- 收據與截圖：主工作樹 `.runtime/archive/composer-model-effort-20261028/`。未用正式聊天室、真實模型推論或真實手機驗收。

## 審查與發布

- 真正 Opus 5.5（high）第一輪 `composer-model-effort-opus-review-20261028`：無讀值或架構問題，指出 320px 的 GPT「超高（Ultra）」／「原生預設」可能超出文字區，原探針只測 Claude 短文字，建議省略號與補幾何測試。
- 主代理補測後確實重現 GPT Ultra 的 `effortFits:false`（`long-effort-before.log`）。採納問題與補測，未採省略號：手機無 hover，且本人要看見強度，改用 `white-space:normal;overflow-wrap:anywhere` 保留全文。幾何檢查另驗證文字右界不超過設定圖示，新增 GPT Ultra／原生預設的 320px 情境與截圖。
- 真正 Opus 5.5（high）第二輪 `composer-model-effort-opus-followup-20261028`：確認最小修法足夠、無新阻擋，最終建置的 UI 全套（含 modal-scroll）通過即可合回並準備更新。兩輪皆唯讀審查，未執行測試。
- 工作樹 `D:\K-harness-worktrees\composer-model-effort`，基線 `925dffff2f91d07850d0224e469a4230d8a70258`。
- 已驗收程式版本 `3c22535e4f7b8e80af41f197c99dda09068e036c`；程式與本工程紀錄分開提交，合回 main 後由既有 `.local/update-ready.json` 提供此版本。
- 正式環境仍為 `9013efdb15d6e59e66cbd9bee9162026f87932a2`。K 內無法更新正在執行的自身，依既有流程待本人按側欄「更新」；未執行自我停止、正式部署或 push。正式畫面讀回與部署後 push 尚未完成；東區未更新。
