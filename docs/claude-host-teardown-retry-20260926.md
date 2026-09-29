# Claude host 關閉失敗保留重試句柄（2026-09-26）

## 差異

- `src/claude-controller.mjs` 的 `close()`、`stop()`、`selectWorkspace()`、送出時權限／推理重啟路徑，不再於 `await active.close()` 前清空 `host`；只有 close 成功且目前仍指向同一 host 時才清除並結算原生子代理。
- host close 失敗時保留 host 供後續重試，狀態明確維持 `uncertain`，不因缺少句柄把失敗後的第二次 shutdown 誤判成功。
- `open()` 原舊 host 關閉路徑本已在 close 成功後清除。修正其 `previousClosed` 清理新 host 分支：清理成功才清除句柄；失敗保留 host、標記 uncertain，並以 aggregate error 保留原開啟錯誤與清理錯誤。
- 未改 `src/claude-host.mjs` 的 processError／closed 語意，避免將模型程序錯誤與 runner 終止證據的區分擴大成此次修補。

## 驗證與限制

- 新增兩項 regression：close 連續失敗兩次均維持 uncertain、句柄可再試，第三次成功才變 offline；stop 失敗後保留句柄，後續成功重試才變 interrupted。
- `node --test test/claude-controller.test.mjs`：45/45 通過。
- 只做本機 mocked-host focused 測試。未啟動 Claude、未占用 Sandboxie pool，未做 UI 或 live shutdown 驗收；這些由主代理另行驗證。
