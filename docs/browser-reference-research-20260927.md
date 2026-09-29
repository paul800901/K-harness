# 瀏覽器接線研究：Claude Code、Codex、VS Code 與開源方案

日期：2026-09-27。狀態：**官方文件／公開原始碼研究與 Chrome 假頁接線試驗；未更換正式瀏覽器，未驗證 Google 真登入。**

## 使用者目標

### 後續決定與開源對照

使用者本輪明確選擇改用外部瀏覽器方向，要求對照 DSH、Pi 與開源 harness。這是路線決定，尚未更换正式執行路徑或安裝擴充。驗收需同時涵蓋本人登入後 AI 同頁接續，以及不共用既有登入的暫時乾淨查詢；不能只完成前者。內嵌路線不再作為長期雙軌目標，替代驗收前仍保留可還原資料。

- DSH 官方是插件架構；Web UI 在瀏覽器開啟不等於 AI 控制瀏覽器。來源：https://github.com/deepseek-ai/deepseek-harness 。社群 `wqty123/dsh-browser` 提供真實可見瀏覽器及 CDP 控制，但不是官方原生能力，也未於 K 驗證：https://github.com/wqty123/dsh-browser 。
- Pi 官方是可擴充代理，不能把第三方瀏覽器能力當成 Pi 核心內建。來源：https://github.com/earendil-works/pi/tree/main/packages/coding-agent 。Browser Use Pi 的公開 session 文件分為既有 Chrome CDP、保留登入 profile、臨時 profile；這是獨立專案而非必要替换 K 主代理：https://github.com/browser-use/browser-use-pi/blob/main/docs/sessions.md 。
- Microsoft Playwright MCP 已提供 extension 既有分頁、persistent profile 與 isolated context。優先沿用 K 現有控制器，驗證外部 Chrome 接線；不因新方案存在而安裝另一個代理核心。Chrome 真無痕視窗的擴充權限與附接仍未驗證，乾淨 context 不冒稱已通過 Chrome 無痕驗收。

K 要支援 Google 服務及一般網站登入，並在本人登入後由 AI 接續操作；不接受只改用 TikTok QR 碼便宣稱解決。2026-09-27 後續要求先研究成熟產品及開源作法，不能把「更換成完整 Chrome」未驗證地當成定案。

## 查證結果

| 對象 | 已確認的機制 | 不應推論 |
|---|---|---|
| Claude Code | 官方 Claude in Chrome 擴充功能連接真實瀏覽器；沿用同一瀏覽器登入狀態，登入／CAPTCHA 交由人操作 | 不是把 Chrome 網頁引擎嵌進 Claude Code；也不是開源通用瀏覽器元件 |
| Codex / ChatGPT 桌面 | 官方文件區分外部瀏覽器擴充功能及 `@Browser` 內建瀏覽器；外部連線支援 Chrome 等多種瀏覽器 | 無公開依據證明兩路都「啟動使用者電腦上的 Chrome」；未確認內建登入的內部實作，不猜測特殊 Google 白名單 |
| VS Code | MIT 公開原始碼 `BrowserView` 真正使用 Electron `WebContentsView`；分開管理 session、顯示生命週期、CDP、權限。官方 agent 工具可讀頁面、操作、截圖、執行 Playwright，使用者可分享已有狀態的頁面 | 不是單純把外部 Chrome 窗口塞進編輯器；一般 authentication 支援不等於每個第三方 Google OAuth 都通過 |
| Playwright MCP | Microsoft Apache-2.0；有官方 extension 連接現有 Chrome/Edge、CDP 連線及自行啟動等模式 | 本機可自動啟動 Chrome 不等於 Google 接受該啟動模式登入 |
| Chrome DevTools MCP | Google ChromeDevTools Apache-2.0；基於 Puppeteer 控制 Chrome，支援本人啟用及核准的既有瀏覽器連線 | 不是現成嵌入式人類介面；也不自動提供 K 的聊天室隔離／接手鎖 |

VS Code `browserView.ts` 的 full-page screenshot 註解也指出非 100% zoom 的 CDP clip 問題、捲軸及擷取缺陷。因此不能說成熟產品完全沒有相同底層問題；其公開處理值得逐項對照，但不是直接搬入整個 VS Code 架構。

## K 本機實況與接線試驗

- 已安裝 `@playwright/mcp@0.0.82`，本機 README 已有 `--extension`、`--cdp-endpoint` 及 `--profile-dir-name`；不是缺少瀏覽器控制套件。正式目前把這個控制器接到自製 Electron 原生 view adapter。
- 已確認本機 Chrome 153.0.8010.53、Edge 153.0.4234.48 存在，沒有安裝或升級。
- 新建假資料試驗：`.runtime/chrome-native-connection-20260927/probe.mjs`；結果 `.runtime/chrome-native-connection-20260927/1790441983257/result.json`。
- 使用 K 現有 owner gateway + 官方 MCP，接完整 Chrome 的新專用 profile：導航成功；人工接手期間 MCP 拒絕操作；測試驅動模擬假登入後交回，AI 工具在同頁讀到同一份假狀態並完成假操作。未複製 cookie、未讀日常 profile、未登入外站、測完正常關閉測試瀏覽器。
- 此次是 Playwright 自動啟動模式，`navigator.webdriver=true`，不偽裝。**不能把這個 fake pass 當成 Google 登入 pass、真實人類接手 pass、正式 OS 隔離 pass 或內嵌面板 pass。**

## 建議，而非已部署設計

1. 保留 K 的主模型、訂閱路線、既有控制權及隔離邊界；優先沿用已安裝的官方 Playwright MCP，不再造代理核心。
2. 登入相容性優先驗證「本人正常使用的 K 專用完整 Chrome + 官方擴充連線／明確核准的附接」，而不是用自動啟動後能開頁面就宣布成功。新擴充安裝／瀏覽器安全設定須先明確確認；不私自連日常全 profile。
3. 面板內嵌呈現是另一個工作：對照 VS Code 公開生命週期、視窗還原與顯示同步作法。不要把截圖串流假裝成可互動內嵌瀏覽器，也不承諾外部 Chrome 登入自動轉入 Electron。
4. 真正驗收：Google 本人登入 → 同一分頁／同一 session 交回 AI → 僅做本人指定的無副作用檢查 → 重啟／切頁／最小化还原 → 再驗控制權與隔離。成功前不更換正式瀏覽器或宣稱可取代 Codex 的登入能力。
5. Google OAuth 官方政策限制開發者控制的嵌入式 user-agent。不能靠去掉產品辨識、偽造 UA、關閉安全檢查或搬運 cookie 作為長期解答。K 不持有 TikTok 的 OAuth client，不能自行改它的 redirect URI；登入支援需在真正使用環境中驗證。

## 來源（本輪已開啟讀取）

- Claude Code 官方：https://code.claude.com/docs/en/chrome
- OpenAI 官方瀏覽器擴充文件：https://learn.chatgpt.com/docs/chrome-extension
- OpenAI 瀏覽器文件：https://learn.chatgpt.com/docs/browser?surface=app
- VS Code agent browser tools：https://code.visualstudio.com/docs/agents/run/browser-tools
- VS Code integrated browser：https://code.visualstudio.com/docs/debugtest/integrated-browser
- VS Code MIT 原始碼：https://github.com/microsoft/vscode/blob/main/src/vs/platform/browserView/electron-main/browserView.ts
- VS Code session 原始碼：https://github.com/microsoft/vscode/blob/main/src/vs/platform/browserView/electron-main/browserSession.ts
- Playwright 官方連線模式：https://playwright.dev/mcp/configuration/browser-extension
- Playwright MCP：https://github.com/microsoft/playwright-mcp
- Chrome DevTools MCP：https://github.com/ChromeDevTools/chrome-devtools-mcp
- 其附接方式：https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md
- Google OAuth 政策：https://developers.google.com/identity/protocols/oauth2/policies#use-secure-browsers

本輪不做任意網站全部相容的保證；網站政策與帳號條件仍需實測。原先黑屏修正另案驗證，不把研究結果混成修正已部署。
