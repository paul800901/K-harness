import {fileURLToPath} from 'node:url';

const literal = value => "'" + value.replaceAll("'", "''") + "'";
const reader = fileURLToPath(new URL('../scripts/read-text-page.mjs', import.meta.url));
const node = process.env.K_ISOLATED_PARENT_NODE_EXECUTABLE ?? process.execPath;

export const CODEX_READING_GUIDANCE = `K Codex 原文讀取規則：
- 使用者交付及任務必讀的資料，初次讀取保留原文，不為節省額度先摘要、刪段、只留頭尾或自行挑重點。依任務先界定需要的來源與範圍；檢索只用來定位，搜尋片段不能冒充完整讀取。
- exec_command 的單次輸出、functions.exec 的批次總輸出及原生歷史保存各有容量限制。指令 exit 0、看見頭尾均不代表內容完整。Warning: truncated output、tokens truncated、Omitted long matching line 或缺頁表示尚未讀完；先從原來源補齊所需範圍再判讀。不能要求使用者重述已提供且可查回的內容。
- 長 UTF-8 原文可透過既有原生 shell 執行唯讀分頁器，PowerShell 命令：[Console]::OutputEncoding=[Text.Encoding]::UTF8; & ${literal(node)} ${literal(reader)} '<原檔路徑>'。接續在路徑後傳前頁 nextOffset 與 version；起訖以 UTF-8 bytes 計，逐頁確認 startByte 等於前頁 endByte，直到必讀範圍完整覆蓋（全文須 nextOffset=null）。text 是原文，保留換行、BOM 與 Unicode。版本變更或讀取失敗時不得拼成已讀全文。直接執行並原樣回傳，不經 PowerShell 變數、管線或 ConvertFrom-Json 轉接；確需解析時，仍必須先設上述 UTF-8，避免系統字碼頁使中文靜默失真。只在原有命令及檔案權限允許時使用；工具不可用時以同樣原則做有界原文讀取，不擴權。
- 分頁器每頁連同 JSON 跳脫最多 6000 UTF-8 bytes；使用 functions.exec 時明設外層 max_output_tokens 至少 10000，內層 exec_command 至少 10000，直接 text(result.output) 交付原文，不再只印摘要、檢查結果或重包整個結果 JSON。長正文一頁一個外層回傳；不要把多頁／多檔又合併成一次超額輸出。短且已知放得下的獨立讀取仍可批次。任何更低的原生限制仍須檢查，不能把這組額度當成不截斷的保證。
- 分段僅改交付大小，不濃縮內容。不為省額度主動提前壓縮對話；原生核心真的壓縮後，依賴細節的判斷回查原文。保留來源與讀取範圍，不能把摘要當原文，也不能聲稱已關閉所有原生壓縮。
- 有副作用的命令若輸出截斷，只查既有結果／保存紀錄，不為取得完整輸出重跑。分頁器與指引不保證所有原生工具已強制防漏，依實際交付證據驗收。`;
