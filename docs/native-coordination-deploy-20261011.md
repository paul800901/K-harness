# 原生調度與本人目標意圖正式更新（2026-10-11）

## 正式結果

本人明確要求「等等你直接更新 K，K 已關掉」。Astra 核對停止、固定差異與既有真正 Opus 審查後，由 GPT-6.1 Sol 單一部署，Astra 獨立讀回。臺灣時間 16:19 完成正式服務及雙尺寸介面驗證，16:20 再確認日常 K 維持關閉。

- runtime：`cfd4eba1a9e514158c39151a0f8d6c4a67eb5a57`；產品 source：`e3f2ecd263b1dfd854ea10acdbb31a86b54ae713`，兩者之間僅文件。
- 前版：`e1712d117d3c7f2d4f1df7ffd0b2beb94ffa15e1`；可退程式／啟動器：`D:/K-harness/.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/releases/before-1791706641172`。這不是對話資料快照。
- 既有 `activateRuntime` 一次交換程式與啟動器；未換原生核心、相依版本、登入、計費、語音、瀏覽器位置或全域設定，未 push／更新東區。

## 包含與未包含

1. [過期／重複警告](native-terminal-notice-reconciliation-20261011.md)：同 child／turn／status 有確切 settled 證據才解除，原始事件保留。
2. [自主核實與必要通知](native-terminal-autonomous-reconciliation-20261011.md)：live 終態不因一次空 summary 消失；程式只讀核實後沿既有入口交付主代理。等待／讀狀態不是常駐監工模型；真正主代理核對回合會使用模型額度。
3. [本人目標意圖](native-goal-provenance-20261011.md)：人類操作補 `origin:user`，AI 保持 automatic，保留原生壓縮與權限。

**失敗主回合的「核對成果後自動接續」已獲本人允許，但只有方案，未納本次產品。** 本人原先誤以為高階模型會持續花額度待命，不是要求 K 遇錯放著。下一段仍須實作、驗證與真正程式複查。本次未恢復／重播原小說；服務端 compact 內因、極長任務記憶／品質偏移不宣稱已解決。

## 驗證與獨立讀回

- 固定 source 全套 `node --test --test-concurrency=4 test/*.test.mjs`：1251/1251、0 skipped。真 Opus 5.5 自主核實末審 `53e0bcb4-1a2a-4394-a63f-f86b78abb49a`、provenance 增量 `07b576e8-e08a-45b0-bded-53685bee974e`；前 UI 批 review 見該批文件。末審後 test-only 校正及原預設並行失敗保留，不冒稱 Opus 看過全部追加測試。
- 候選 UI／extension／C# launcher 三 build exit 0；prepared 228/228。package manifests 相同，重用既有 standalone dependencies，未安裝套件。
- 正式 674 個 tracked 檔逐 byte 對固定 commit 零差異；正式啟動器／入口匹配候選，退版檔存在。
- 送審工作樹 controller hash `93c4ec09a20a0993c4c547bf6d4338e9a25232db15bdde09bc93d3a33907b0e4`；正式 canonical blob `61598931c856127fafddd6feddac1c00a369d5f7e3a412055d098adb94e17434`。Astra 獨立確認只差 1006 個 CRLF 轉 LF，正式與 Git blob 完全一致，不宣稱不同換行 raw hash 相同。
- 真正正式 owner、HTTP assets hash、桌面 1440×960／手機 390×844 schema／側欄讀回；UI 26 房、未選原房、0 API POST、0 pageerror、0 新模型工作回合。Astra 另看兩張截圖；不是人工點日常捷徑／tray 驗收。
- 74 份 main-session 清單與 hashes 全不變；Astra 另以自己更新前快照比對 selected cores、Codex config、projects、runtime 非版本設定。Google ops 亦不變，未讀取／搬移登入憑證。
- Gemini 快取僅 `/accounts/4/auth/checkedAt`、`/accounts/4/lastQueryAt`、`/accounts/4/quota/checkedAt` 三時間更新；本機前後內容比對其餘欄位相等，不誤報全部檔案無變動。
- 自有驗證 browser／owner 正常關閉；47831／5199 無監聽、無 K 主程式／supervisor／模型工作程序。Chrome native host PID 29932（parent 17824）保留，不停止瀏覽器。

## 製作失敗保留

Windows tar 初次不接受兩個中文 cmd 名，限定 base 內保留 partial，改用既有 Python 標準 tar。Git archive 初次受 `core.autocrlf=true` 影響，664 檔只差換行而未通過固定來源檢查；單次 `git -c core.autocrlf=false archive` 後三 build、674 bytes 比對通過，不改全域設定。原 prepared 228 測試因只差換行沿用，不冒稱 canonical 後重跑。一次 preflight 誤將 Chrome native host 算作 K，修精確分類後才送出唯一交易；失敗時皆未套用正式版。

證據：`D:/K-harness/.runtime/native-coordination-repair-20261011/deployment/` 內 `final-receipt.json`、`validation.json`、`installed-source.json`、`formal-readback.json`、`final-preservation.json`、`stopped-after-readback.json`、`root-reviewed-source-readback.json` 及失敗紀錄。私人 runtime 證據不納 Git；原兩個未追蹤項保留，無清理。
