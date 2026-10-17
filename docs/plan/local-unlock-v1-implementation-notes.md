# 本機解鎖插件 v1：implementation notes

對應設計：`docs/local-unlock-v1.md`。基礎：分支 `local-unlock-v01`（a4832af），已在 master 94fa197 之上，rebase 為 no-op。工作在 worktree `naki-plugins-wt-unlock-v1`，分支 `local-unlock-v1`。對照的 Naki 是 main（開工時 f8a2915，驗收時 8829e99「Release v2.20.0」），只讀檔與跑 node 腳本，沒有碰執行中的 App。

## 範圍

- `plugins/naki-plugin-ex-local-unlock/`：`plugin.js`、`plugin.json`（1.0.0）、`settings.html`、`README.md`。
- `tests/local-unlock.cjs`（假 ctx）、`tests/local-unlock-naki.cjs`（Naki 實際 runtime，需 `NAKI_ROOT`）。
- repo `README.md` 插件表與設定頁段落。

## Deviations

1. **worktree 取代就地 checkout**：派工寫 `git checkout -b local-unlock-v1 local-unlock-v01`。改用 `git worktree add -b local-unlock-v1`，分支與基準相同，只是不動 master 工作樹，避免與其他工作包共用時互相干擾。
2. **對局內不做變長**：派工範圍含稱號，但 Phase 4 禁改名單含全部 `.lq.FastTest.*`，`authGame` 只能等長。對局內維持 v0.1 行為，零稱號帳號在對局內仍不生效；大廳個人資料的稱號改走 `fetchAccountInfo` 變長。
3. **四個允許方法只用兩個**：`fetchAccountCharacterInfo` 的 `unlock_list` 語意未確認，不猜；`fetchAllCommonViews` 是大廳裝扮，v0 設計 F5 因擁有來源未確認而預設關閉。兩者都不改。
4. **派工的 F1–F3 與 v0 設計編號不同**：v0 設計 F1 是對局內角色（因 `broadcastInGame` 外送風險不做），大廳角色是 F4、稱號是 F6。v1 做的是 v0 設計的 F4（角色、皮膚、頭像，不含星標）與 F6 的「顯示」部分，加上保留 v0.1 的 F2、F3。F6 的稱號清單（`fetchTitleList`）不在 Phase 4 允許清單，不做。
5. **設定沿用平坦 key，不用 v0 設計 §5.3 的 `features`／`overrides` JSON**：新增 `characterId`、`skinId` 兩個 number。舊 key 不改名不改型別，免遷移。
6. **守衛宣告 19 個全部**：派工寫「守衛所有換裝類方法」，Naki 的 `GUARDABLE_METHODS` 只有 19 個能宣告，全部宣告，包含領獎、送禮等非換裝方法（保守：多擋不少擋）。
7. **插件自擋，不只靠 Naki 污染**：Naki 污染後，若 L3 總開關開著且守衛者放行，守衛方法會原樣送出（`guardFailure`）。插件因此在改過任何一則後，對守衛方法一律拋錯，Naki 判 `hook_threw` 本地拒送。旗標放在 `window.__nakiLocalUnlockTouched`，熱停用再啟用不重置。對局內的等長改寫也會設旗標，雖然 Naki 只對大廳連線污染。
8. **禮貌降級的判斷**：以本插件 grant 含 `reshapeReceive`、`sendGuard` 含全部 19 個、`__nakiPlugins.isReshapeForbidden` 存在三者同時成立為準。舊版 Naki 的 Swift manifest 解碼會忽略 `sendGuard`，所以 grant 裡沒有。不成立時連對局內等長也不做（派工：無 Phase 4 → 插件停用）。
9. **kill-switch 只看 `replace` 回傳值**：不讀 `__nakiWebSocket.diagnostics()`（v0.1 的靜態測試禁止插件碰 `__nakiWebSocket`）。變長 replace 回 `false` 一次就停本頁面的大廳改寫；原因可能是鎖死、不合規或方法被禁，插件不區分。
10. **補進的角色只寫 `charid` 與 `skin`**：`level`、`exp` 等用 proto3 預設值 0，不猜遊戲要的初始值。
11. **損壞的自家 Account 記 log**：初版把 `account_id` 解不出來的 Account 當成他人靜默略過，測試發現後改為「結構不符」記 log；真正的他人資料仍靜默。
12. **Naki 的 `scripts/plugin-regression.cjs` 不載入本插件**：它只寫死測 tile-highlighter 與 name-hider。派工要求它仍全綠，已跑；本插件與 Naki runtime 的整合另由 `tests/local-unlock-naki.cjs` 覆蓋。

## 驗收

證據在 Naki repo `.swfd/logs/unlock-v1/`（`plugin-regression.log`、`plugin-tests.log`、`mutation.log`、`mutate.cjs`）。

| 項目 | 結果 |
|---|---|
| `NAKI_ROOT=<Naki> node --test tests/*.cjs` | 55／55 通過（local-unlock 38、local-unlock-naki 4、name-hider 7、settings-pages 6） |
| 不設 `NAKI_ROOT` | 51 通過、4 略過 |
| Naki `node scripts/plugin-regression.cjs <本 worktree>` | 38／38 通過 |
| 變異 19 個（守衛拋錯、touch、降級三條件、自家比對、錯誤欄位、去重、kill-switch 等） | 全部被殺；初跑 2 個存活是測試太弱，已補強測試，插件未改 |
| 跨 repo：遊戲收到變長改寫後的 `fetchCharacterInfo` | Naki `reshape` 計數 attempted 1、delivered 1、fallback 0、faults 0 |
| 跨 repo：改寫後 `changeCharacterSkin` | 不外送，遊戲收到 `Error.code = 6` 的本地回應；L3 開著時原因為 `hook_threw` |

## 未驗證

- live 全部（等 Naki 2.20.0 發布，由主線另派）：大廳畫面效果、補進的角色是否正常顯示、本地錯誤在遊戲的表現、伺服器無同 msgId 回應的外送證明、外送盤點與 v0 設計 §3.7 比對。
- Swift 端 manifest 驗證未實際執行，只讀 `PluginManifest.validate` 的規則比對（`reshapeReceive` 與 `rewriteReceive` 同宣告、`sendGuard` 非空且全為 `.lq.Lobby.*` 並在 `methods`）。
- 舊版 Naki（2.19.0）實際載入本 manifest 的行為：推測忽略 `sendGuard` 與未知 capability 後照常載入，插件判定不支援而不改寫；未在 App 內驗證。
- `ResCharacterInfo`、`Account` 欄位號未用 live 封包核對。
