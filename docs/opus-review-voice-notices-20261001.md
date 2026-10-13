# Opus 複查：語音接線修復與工程通知退至後台（2026-10-01）

> 對象：正式部署的 22ffeb8（只換 4 個前端檔），紀錄見 [voice-notices-cleanup-regression-20261001.md](voice-notices-cleanup-regression-20261001.md)。部署後複查；只讀、未改程式、未開麥克風、未送模型工作。

## 結論：通過

- **語音根因正確、修法最小**：
  - 問題：R3-2 從視窗 preload 刪掉 `kBrowser.present`，但 `voice-composer.jsx` 拿它來判斷「是不是在 K 原生視窗裡」。判斷變成 false，於是改走 Electron 裡本來就會失敗的 Web Speech。
  - 修法：改成判斷仍存在的 `onWindowHidden`，只改 1 行，沒有加備援路徑或重試。
- **獨立回查：沒有其他同類斷線**。
  - 已部署的前端原始碼與提供給畫面的 JS 檔，對視窗介面只呼叫 `onPageChanged`、`onWindowHidden` 兩個，正好就是 preload 實際提供的兩個。
  - 主程序也只送出這兩個頻道，沒有殘留的 invoke handler。
- **工程通知**：只在「顯示」時濾掉 6 類工程提示（status、deprecation、config、Windows 可寫目錄、沙箱就緒、沙箱設定完成）。錯誤、未知警告、guardian、模型改派、額度與核准都照常顯示；後端原始事件不刪，符合使用者 10-01 的決定。
- 部署檔：兩個前端來源與 22ffeb8 一致。

## 建議（非阻擋）

1. **偵測方式仍是間接的**：「是不是原生視窗」靠某個恰好存在的函式來推斷，下次清理時可能又被誤刪。R3-3 可以讓 preload 明確提供一個原生外殼標記，或直接用 Electron 的 userAgent 判斷，並把這條判斷放進回歸測試（這次已補真 preload 測試，方向正確）。
2. **兩份原始碼仍未合一（上次建議尚未處理）**：正式版在 `codex/r3-2` 分支（C 槽工作樹），`D:\K-harness` 的 `main` 仍停在 56bb038，`src/` 仍有 26 個正式版已刪除的模組。建議盡快讓 main 等於正式版。

## 未實測

- 真麥克風收音（口音、長段）只能由使用者實際試。
- 合成音訊已驗證整條路徑：畫面 → 錄音 → 本機 Whisper → 填回草稿。
