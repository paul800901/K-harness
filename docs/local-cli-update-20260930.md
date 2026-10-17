# 本機 Claude Code／Codex 更新（2026-09-30 20:44）

## 授權與範圍

使用者要求本機 Claude Code 也升至最新版，Claude Code 與 Codex 都採最新版本。本輪更新原有全域 Claude Code 安裝，並查核目前 Codex CLI 與 Codex App；不改登入、模型、權限或計費設定，不安裝另一套 Codex CLI，不新增排程。

## 實際結果

| 項目 | 更新前 | 完成狀態 |
|---|---|---|
| 本機 Claude Code | 2.1.280，npm 安裝 | 官方 npm `latest` 為 2.1.285；原安裝更新至 **2.1.285** |
| 本機 Codex CLI | 0.159.2，Codex App 管理的執行檔 | 與官方套件 `latest` 0.159.2 相同，不重裝、不切 alpha |
| Codex App | 26.928.21956，build 12404，prod | 內建更新檢查回傳 **up_to_date**；指目前設定管道無適用更新，未重啟 App |

Claude 沿用[官方 npm 更新方式](https://code.claude.com/docs/en/setup#install-with-npm)：`npm install -g @anthropic-ai/claude-code@latest`，正常完成，更新 2 個套件。更新前確認沒有執行中的全域 Claude 程序；當時 K 的獨立 Claude 程序仍在執行，沒有中斷它。

## 驗證與可還原性

- 原入口 `C:\Users\Paulus\AppData\Roaming\npm\claude.cmd --version` 實測回傳 `2.1.285 (Claude Code)`；套件版本一致，`--help` 啟動成功。
- 更新後 Windows 簽章為 **Valid / Anthropic, PBC**。SHA-256：`121FC8151ED40BD9C144D68AA1CEA23427803628FFAB65E23DA1CCEDA155697E`。
- 原入口 `C:\Users\Paulus\AppData\Local\OpenAI\Codex\bin\c6fe824d725f02d7\codex.exe --version` 回傳 `codex-cli 0.159.2`。
- 全域 Claude 舊套件（含平台相依）與三個啟動檔備份於 `D:\K-harness\.runtime\local-cli-update-20260930\claude-2.1.280-before-update`；舊執行檔與備份雜湊一致。
- 更新紀錄及實際讀回：`D:\K-harness\.runtime\local-cli-update-20260930\npm-update.log`、`before.json`、`after.json`。
- 檢查到本機 Claude 的更新管道與停用更新設定均未覆寫，保留官方預設；未修改設定檔或任何登入資料。
- 一次只讀程序查詢曾誤用 `ConvertTo-Json -Property`，只影響輸出；已改用 `Select-Object` 後重新查詢成功，沒有因此停止程序或改設定。

## 邊界

本輪沒有修改或重啟 K；K 專用 Claude 2.1.285 的部署仍見 [R3-2 紀錄](r3-2-cleanup-20260930.md)。沒有送模型工作，不消耗模型額度驗證，也不把版本／啟動成功當成真實模型任務驗收。本輪僅更新本機工具，不宣稱未來會在此對話結束後自動持續更新。
