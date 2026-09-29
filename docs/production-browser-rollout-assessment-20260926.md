# 正式 K 隔離接入與瀏覽器可行性評估（2026-09-26）

> 歷史評估：使用者後來已明確選擇「新隔離工作區／新聊天室」，不要舊原生歷史續接；也已授權驗證 externalSandbox。下方列的是決定前的限制，不是最新完成／阻擋清單。後續 supervisor、外部隔離、雙模型 UI 與正式切換統一見 [整批收尾](closeout-20260926.md)。

## 結論

目前的候選**不能直接替換正式 K，同時保留並可續接既有對話與原工作區**。候選是固定假資料 workspace + 獨立 vault/provider-home 的整套部署；正式啟動器仍只會啟動一般 `Start-K-Desktop.ps1`。直接把候選程序接到正式 port 或只打開舊 browser 開關，既不會保留原資料拓樸，也不構成同等隔離。

正式部署的最小前置決定是：使用者選擇以「新隔離工作區／新對話」為先，讓舊正式對話留在原位置、不保證續接；或以「既有對話／D:\\K-harness 工作區可續接」為先，先設計和授權獨立的歷史、workspace、可信程式及隔離邊界接線。不能把兩項都承諾為這次簡單替換。若需要大量移轉或原生歷史搬遷，應縮小／分期，而不是假定一輪全部完成。

## 已有能力與限制

- `local-launcher/KTrayLauncher.cs` 固定呼叫 `Start-K-Desktop.ps1 -NoBrowser`、檢查 47831，且以 `/health.workspace` 精確比對安裝根；`Start-K-Desktop.ps1` 啟動一般 `src/desktop-server.mjs`。沒有候選／隔離部署選擇器、Sandboxie supervisor 或候選健康識別。因此從系統匣正常重啟會回到一般 K，不會自動繼承候選隔離。
- `src/isolated-desktop.mjs` 要求明確 provider binaries、Sandboxie `pool`、獨立 env、可信瀏覽器服務、固定 port；把 Codex、Claude、Claude→Luna 接到同一受限 runner，且拒絕 workspace 與 state root 相同。外層包裝又把所有 workspace 切換固定拒絕到指定 `selected`。這正是候選假資料工作區的安全限制，不是正式多工作區接線。
- 現成候選的狀態／runtime/provider/home/browser vault 位於 `.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee`。候選測試記錄其登入的是新建隔離 provider-home、工作區固定為假資料目錄；沒有複製宿主舊憑證。原生訂閱歷史和認證由各 CLI profile 持有，K 的對話投影不能代替原生 CLI history；不能只搬 K JSON 就宣稱舊 thread 可 resume。這些本輪僅依既有文件和程式碼評估，未讀任何秘密／憑證檔，也未讀回現場政策或候選程序。
- 正式 K 的既有工作區是 `D:\\K-harness`，同時也是現行應用／可信啟動程式所在樹；候選策略則要求 `trusted-runtime` 與 agent 可寫 workspace 分開。不能把「repo 被 Codex 設為 trusted」當成隔離：只要 agent 可寫該目錄，它就能改變後續重啟要載入的程式。正式化至少要把可信可執行 runtime、K session/state vault、模型可寫 workspace 分開，並明確哪些既有工作區可寫。
- Sandboxie 假資料試點已證明固定測試路徑上的程序／檔案拒絕、指定 loopback WFP 行為、stdio runner 和候選 owner-browser 的若干能力；不證明普通 Sandboxie box 預設會保護所有宿主檔案，也不證明所有正式 workspace、程序、網路或歷史遷移已通過。部署仍須依既有 policy 對每一正式路徑讀回驗證，不得放寬 trusted-runtime 封鎖去讓工作區可寫。
- 候選的瀏覽器架構是 trusted owner gateway 持有 browser/profile、AI 只取得受限 MCP，人工接手鎖在可信端。正式 `.runtime/browser-mcp.json` 目前在既有驗收讀回中不存在；一般 `readBrowserMcpConfig` 指向專案內直接 stdio/profile 的舊路徑，**不能只建立／開啟這個檔就宣稱啟用候選隔離瀏覽器**。候選的瀏覽器 profile／登入狀態也不等於使用者原瀏覽器 profile；不可默默搬 profile/cookie。要正式開啟需把 owner registry/gateway、trusted launcher、MCP endpoint、接手鎖與候選同一政策接線，並先清楚決定是否需要人工重新登入。
- 候選 Codex 的官方 Windows sandbox readiness 記為 `notConfigured`；從未初始化。一般 shell/Node execution、正式工作區下雙層 sandbox 相容性尚未驗收。不得藉正式啟動時初始化、切換模式或退回 host execution。
- 官方 app-server 的 `externalSandbox` 可以代表由外層執行環境負責隔離，但會跳過 Codex 原生 sandbox enforcement；K 現行 `src/desktop-permissions.mjs` 的權限映射也不接受 `externalSandbox`。若採用，須明確決定信任 Sandboxie 為唯一程式執行邊界，接入正式啟動與嚴格失敗關閉，且以正式 workspace 驗證；不得靜默將 `notConfigured` 改成 `externalSandbox` 或擴大可寫根。

## 最小改動範圍（待上節的保存策略決定後再拆期）

1. 正式 launcher 需能只啟動／停止明確識別的隔離 K，並驗證新健康識別；不得從 47831 port 猜程序身分或健康即當隔離就緒。一般模式不能被候選 fallback。
2. 正式 runtime 需置於模型不可寫且由 owner 管理的固定路徑；state/vault/profile 有單獨的明確生命週期；可寫 workspace 逐一指定。保留 `D:\\K-harness` 為工作區時，先將程式 runtime 與它拆離；不要因 trusted 屬性直接授予或拒絕 agent workspace。
3. 歷史要分別驗證 K UI 投影、原生 CLI session/history、browserSessionKey/profile 三種資料。沒有經確認的可續接方案前只可說「舊紀錄保留在原位置」，不能說「原生對話無縫保留」；不可複製憑證或假稱 transcript 移轉等於 thread resume。
4. 瀏覽器須採候選已驗證的 owner-side gateway / AI MCP / 人工接手鎖路徑，不複用舊直接 stdio 開關。先在正式採用的新 owner profile／假站驗證三種控制狀態，再由使用者決定其正式網站登入／持續登入；未授權帳號網站操作不在本次部署內。
5. 僅在 Codex native `notConfigured` 與外層 runner 狀態都已讀回後才選擇 permission route。是否採官方 `externalSandbox` 必須另由使用者選擇；如果保留 Codex 原生 sandbox，則該功能需另授權並完成 setup/ready 驗證。兩者不等價。

## 本次停止線

本文件是可行性評估，不是部署紀錄。這一輪沒有修改 launcher、policy、ACL、帳號、瀏覽器設定，沒有讀秘密／憑證、登入、呼叫模型、啟動或停止正式／候選服務；沒有宣稱部署或 live 驗收完成。正式更換前需要使用者就上面兩種保存策略作一次選擇；Codex sandbox route 與正式 browser profile 的決定仍分開記錄，不能綁成默認授權。
