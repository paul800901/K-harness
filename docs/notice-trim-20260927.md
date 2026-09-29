# 非必要常駐告示精簡（2026-09-27）

狀態：2026-09-27 01:51 已備份套用正式版並由原入口重開；正式隔離健康與新版資產讀回通過。

## 使用者要求與差異
個人工作台只保留需要本人處理的必要提示，不常駐顯示連網／隔離免責文字。底層隔離、網路及原生核准規則不變。
- src/desktop-controller.mjs：移除 externalSandboxNetwork 自動 addNotice。
- frontend/native-ui.jsx、frontend/native-notices.mjs：精確排除舊後端仍可能送出的同類告示；不泛濾 warning/error。
- frontend/main.jsx：移除「子代理準備中；主代理工作可直接送出」常駐旁白。
- frontend/permission-picker.jsx：移除確認畫面重複的瀏覽器旁白及「僅套用到這個對話」段落。保留權限模式實際效果、提高權限確認及選單中的瀏覽器權限差異。
- test/isolated-desktop.test.mjs、test/native-notices.test.mjs：驗證告示不產生／不顯示，原有 externalSandbox 與 native approval 政策不變，錯誤及模型改派仍顯示。

## 驗證
主代理重跑 isolated-desktop、desktop-native-events、native-notices、desktop-permission-modes：26/26 通過。
證據：.runtime/notice-trim-20260927/regression.txt。
建置通過（既有 >500kB chunk 警告保留，未擴修）；第一次相對 outDir 被 Vite 解為 frontend/.runtime，下次改絕對路徑，正式 dist-ui 未覆蓋。
獨立 Electron 真介面、假 controller 候選通過：注入舊 network notice 不顯示；nativeError 顯示且可關閉；worker connecting 不再出現旁白；renderer 無錯誤。
證據：.runtime/notice-trim-20260927/evidence/annotation-ui-2026-09-26T17-49-37-404Z.json；同目錄 candidate-state 下 clean-chat.png。

## 正式狀態與未完成
正式 47831 health 讀回 deployment=isolated，仍開啟。未帶登入狀態的 /api/state 正常拒絕 403；沒有取憑證或繞過。尚無全部聊天室閒置證據，故未停止／更新正式 K。需要正式停止後備份更新這批前端及 desktop-controller，再啟動讀回；未修改對話、設定、登入或隔離權限。其他既存未部署修正不併入本輪。

首輪 DOM 檢查通過，但立即截圖仍捕捉到前一幀錯誤提示；補等候畫面呈現後重跑通過，最終截圖已目視確認無上方告示。首輪證據原處保留。

## 01:51 正式套用
使用者明確回覆「退出了 套用」。部署前 47831 無 listener、無正式 Electron 執行程序；其他 MCP／Codex 工具程序未停止。正式 controller 與來源差異僅移除該告示一行。
已備份並更新 9 個目的地：正式 controller 及根／正式 dist-ui 各 4 個候選資產，舊 assets 原處保留。來源、備份、正式目的地 hash 核對通過。備份與還原對照：`.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/vault/notice-trim-backup-20260927-015109/receipt.json`；部署證據 `.runtime/notice-trim-20260927/deployment.json`。
由 Start-K-Desktop.ps1 原入口重開；health deployment=isolated，正式 HTTP 新 JS 與候選 hash 相同（D2B6A713E731AD90A6416C5BFAA073108A76CD0407675FE2AA044873124B9B1C）。未開新模型回合，正式畫面操作未代驗；告示消失及錯誤保留的互動證據為上列候選。對話、設定、登入、隔離權限未改。
還原時先退出 K，依 receipt.json 將 Existed=true 的 Backup 回存 Destination 並核對 OldHash；新增 assets 可原處保留，不需刪除。