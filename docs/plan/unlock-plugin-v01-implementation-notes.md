# 本機解鎖插件 v0.1：implementation notes

對應設計：`docs/plan/unlock-plugin.md`（第二版）。設計階段的決策與偏離在 `docs/plan/unlock-plugin-implementation-notes.md`（D1–D7），本檔只記 v0.1 實作與清理。

## 範圍

- 實作：`plugins/naki-plugin-ex-local-unlock/`、`tests/local-unlock.cjs`、repo `README.md`。功能只有對局內自家裝扮（F2）與稱號（F3），manifest 6 個 methods。
- 沒有 commit、沒有 push、沒有啟動 App、沒有呼叫 `127.0.0.1:8765`、沒有上網。
- 證據檔放 Naki 主 repo `.swfd/logs/unlock-v01/`：`mutation.log`（實作步 19 個變異）、`cleanup-test.log`、`cleanup-mutation.log`（清理後重跑）、`cleanup-mutate.cjs`。

## Deviations（實作步）

以下由主線依實作步結案報告原文補入（2026-10-15）。皆採保守選項，主線已接受。

1. 派工寫「methods 只列需要的」，實際列了 6 個（`.lq.Lobby.login`、`oauth2Login`、`emailLogin`、`.lq.FastTest.authGame`、`.lq.NotifyAnotherLogin`、`.lq.NotifyAccountLogout`）：設計 §3.4 要求自家身分取自登入回應並與 authGame 請求一致，登出與被擠下線要重置身分。另用 onSend 唯讀取請求的 account_id（沒有 rewriteSend）。
2. worktree 基準 c35e61d 沒有 master 94fa197 的 `settings-pages.cjs` 與 tile-highlighter 的 `settings.html`：不把 master 的檔複製進來，改在 `local-unlock.cjs` 重現同樣的靜態規則，並另用暫存副本跑 master 的原測試（6 項全過）。
3. 「設定不完整」的解讀：views 非字串或格式錯就整個插件不改寫（含稱號）；titleId 不是 1 到 2^32−1 的整數就當 0；稱號與 views 都沒有有效值也不改寫。
4. 熱啟用或登入前就載入時身分未知，所以不改寫，需重新載入頁面並重新登入；設定變更同樣需要重新登入。
5. ViewSlot 缺 slot 欄位視為 slot 0（proto3 預設值語意）；item_id 欄位不存在時略過，不補欄位。
6. 同一欄位出現多次時，全部出現處都等長才改；任一處長度不同，該項不改。
7. repo README 原本沒有插件清單，加了清單表與本插件警語，並列出既有三個插件；master 的 README 也在檔尾追加段落，合併時會有簡單衝突。
8. 專案 CLAUDE.md 要求維護 implementation-notes，但 `docs/plan/` 下四份設計文件不得改動，所以實作步未新增 notes 檔；本檔由清理步新增，Deviations 由主線補入。
9. 編號更正（復驗建議 3）：原範圍段把稱號寫成 F2、裝扮寫成 F3，與設計 §1 相反（F2＝對局內裝扮、F3＝對局內稱號），已更正。
10. 狀態列更新（復驗應修 2）：`unlock-plugin.md` 與 `unlock-plugin-adr-2026-10-14.md` 的狀態列改為「v0.1 已實作（未 live 驗證，未發布）」，其餘內容不動。
11. README 合併（復驗應修 1）：以 master 94fa197 的 README 為底，保留「## 插件」表與「## 自帶設定頁」，警語改為 H2「## 本機解鎖的警語」置於檔尾，並在「自帶設定頁」補上本插件。第 7 點所述的衝突因此已解。

## 清理項（本步，行為不變）

### plugin.js

1. **重複的「欄位恰好一次才取值」收斂成 `only(spans)`**：原本在 `onSend`、登入回應、自家玩家過濾三處各寫一次 `ids && ids.length === 1 ? ids[0].value : 0`。登入與請求的讀取再收成 `idOf(ctx, field)`。
2. **`config` 拆成 `parseViews` 與 `parseSettings`**：原函數同時負責型別檢查、字串解析、稱號驗證。`parseViews` 回 `null` 表示格式無效，記 log 留在 `parseSettings`。`count` 計數改用 `Object.keys(views).length`（slot 已保證不重複，結果相同）。內層的 `num` helper 只用一次，直接內聯。
3. **`rewriteAuth` 抽出 `viewItems` 與 `applyEdits`**：裝扮項目依 slot 分組、與把 varint 寫回位元組，各是獨立職責；`rewriteAuth` 只留身分確認、挑自家玩家、規劃改寫、送 `replace`。log 文字與順序不變。
4. **改名對齊行為**：`size` → `varintSize`（算 varint 位元組數）；`retarget` → `planEdits`（只把改寫排進清單，不就地改）；`config` → `parseSettings`。
5. **註解**：新增的註解只講為什麼（`only` 的「未知視為 0」、`viewItems` 的「省略 slot＝slot 0」、`planEdits` 的「只改長度不變」）。
6. **函數巢狀最深 3 層**（外層 IIFE、函數、callback），未再加深。

**刻意不動**：`onSend` 的 `!ctx.payload` 提前返回。`idOf` 對 `payload` 為空已回 0，但提前返回時不會把 `authReq` 清成 0；移除會改變行為，保守起見保留。

### settings.html

- `ack` 勾選與初次載入各寫一次 `$('controls').disabled = !$('ack').checked`，收斂成 `gate()`。測試對該賦值式的 regex 仍成立。

### tests/local-unlock.cjs

- 新增 `withMe(players, patch)`、`REWRITTEN`、`unchanged(out)`、`rig.ready(id)`，取代各測試重複組裝的「自家改成 400／2000」期望值、位元組不變斷言、登入加請求兩步。
- 「跨 varint 邊界」測試原本用巢狀三元式推導 slot 2 的值，改成表中明列 `slot2`，意圖可讀。
- 刪掉 `'稱號 欄位不存在' || '稱號欄位不存在'` 的雙寫判斷，實際 log 只有前者。
- 刪掉 `bytes.length > 0 && rig.calls.length` 的怪異斷言，改成先呼叫再斷言 `calls.length === 1`。
- 測試名稱本來就描述行為，未改。

### 變異測試

- `mutate.cjs` 的目標字串綁定舊原始碼，清理後有 6 條失效（M01、M03、M06、M07、M16、M17）。複製為 `cleanup-mutate.cjs`，**只更新目標字串，19 個變異的意圖不變**；M01 原式「移除 account_id 比對」改成等價的 `only(...) === selfId` → `only(...) !== 0`。

## 驗收結果

| 項目 | 結果 | 證據 |
|---|---|---|
| `node --test tests/*.cjs` | 33 通過、0 失敗（清理前後相同） | `cleanup-test.log` |
| 19 個變異 | 全部被殺、存活 0 | `cleanup-mutation.log` |

## 未驗證

- 欄位號取自已知過期的 `liqi.json`，未用 live 封包確認；`replace` 是否被 Naki 接受未在 App 內驗證（與 README「未驗證」一致）。
- 「行為不變」由既有 33 個測試與 19 個變異證明，沒有另做新舊實作的差異比對。

## 復驗

復驗報告：Naki repo `.swfd/logs/unlock-v01/verify-report.md`。對象為 c35e61d 上未 commit 的檔案，Naki main 129a67f。

| 項目 | 結果 | 證據（Naki repo `.swfd/logs/unlock-v01/`） |
|---|---|---|
| 跨 repo 實測（node，載入 Naki 實際的 naki-core／websocket／plugins runtime） | 12/12 通過；`ctx.replace` 回 true，整包長度不變，差異只在自家稱號與裝扮 `item_id` | `verify-cross-repo.log` |
| N7 交叉核對（XCTest，把改寫前後 bytes 餵給 MajsoulBridge） | 9 tests、0 failures | `verify-n7-test.log` |
| 變異測試 | 19 個全殺、存活 0 | `verify-mutation.log` |
| 疊到 master 94fa197 跑全部測試 | 合併後 README 下 39/39 | `verify-master-overlay-test2.log` |

### 復驗後仍未驗證

- live 封包的欄位號與形狀（欄位號取自已知過期的 `liqi.json`）。
- App 內 `ctx.replace` 是否被接受（只在 node 以 Naki 的 JS runtime 驗過）。
- `titleId` 經 Swift `grantDict` 存成 Double 後，到 JS 是否仍是整數（推測是，未驗證）。
- 遊戲客戶端收到改後 bytes 的畫面效果。

### 已知的建議項（未處理）

1. `authReq` 是單一變數，沒有依 msgId 配對。推測只有在前一個 authGame 請求沒有回應、下一個又是壞包時才會誤比對，風險低，未驗證。
2. Naki 端的 `pendingMethods` 只以 msgId 為鍵，不分 socket。大廳與對局連線若同時用到相同 msgId，RESPONSE 的 method 可能對錯。推測，未在 live 觀察，非本插件範圍。
3. `ViewSlot` 另有 `item_id_list`(4)，插件只處理 `item_id`(2)。若某 slot 實際以 `item_id_list` 顯示，覆寫可能無效，只影響效果、不影響安全。需 live 確認。
