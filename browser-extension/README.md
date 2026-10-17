# K 瀏覽器助手

這是 K HARNESS 的 Chrome MV3 unpacked extension，基於 Microsoft Playwright Extension，Apache-2.0。正式版裝在 K 專用 Chrome 的 `installed/k-browser-assistant`，由 `scripts/Setup-K-Browser.ps1` 從正式 runtime 的建置更新。

## 上游與版本

- 上游：`microsoft/playwright` `packages/extension` 與 `packages/playwright-core/src/tools/mcp/{cdpRelayV2.ts,browserModel.ts,protocol.ts,log.ts}`
- 固定 Git commit：`78ff4260d79b924724bdcc4ccd89e463b8f43b0d`，與本專案 Playwright npm 版本 `1.64.0-alpha-1789764292000` 的 `gitHead` 相同。
- 完整 Apache-2.0 授權見 `LICENSE`。未沿用 Microsoft Web Store 擴充 ID；K 的公開 extension key 在 `manifest.json`，對應私鑰只留在忽略的 `.local/`，不要提交或輸出。

## 模式邊界

Connect URL 必須帶 `mode=regular` 或 `mode=incognito`。選擇器只列出對應模式的頁籤，背景程序會再次從 Chrome 讀回所選頁籤及其 URL／模式；attach 也會拒絕跨 regular/incognito。一般模式連線使用 K 分頁群組擴充控制範圍；無痕模式不使用 tab group，只追蹤被 relay attach 的所選頁籤與 K 建立的分頁，不會自動接管使用者另行開啟的頁籤。K 一律在新建的空白分頁工作；缺少所選模式的視窗時，擴充以縮小狀態自行開啟（本人 2026-10-18 決定）。Chrome 必須由使用者在擴充詳細資料明確打開「允許無痕模式」才能接觸無痕頁籤。瀏覽器仍使用 K 專用 profile；這不會讀取既有日常 profile 或其登入資料。

## 建置

使用工作區既有 Vite 8，不新增依賴：

```powershell
node browser-extension/build.mjs
```

Unpacked extension 輸出於 `browser-extension/dist/`。「允許無痕模式」須由本人在擴充詳細資料頁打開。
