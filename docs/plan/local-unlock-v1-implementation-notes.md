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
7. **插件自擋，不只靠 Naki 污染**：Naki 污染後，若 L3 總開關開著且守衛者放行，守衛方法會原樣送出（`guardFailure`）。插件因此在改過任何一則後，對守衛方法一律拋錯，Naki 判 `hook_threw` 本地拒送。旗標現為 `window.__nakiLocalUnlock.touched`（第二輪起，與大廳鎖 `lobbyLocked` 同一物件；第一輪的 `window.__nakiLocalUnlockTouched` 已取代），熱停用再啟用不重置。對局內的等長改寫也會設旗標；第二輪起對局內只在宿主已污染後才改（第 13 項）。
8. **禮貌降級的判斷**：以本插件 grant 含 `reshapeReceive`、`sendGuard` 含全部 19 個、`__nakiPlugins.isReshapeForbidden` 存在三者同時成立為準。舊版 Naki 的 Swift manifest 解碼會忽略 `sendGuard`，所以 grant 裡沒有。不成立時連對局內等長也不做（派工：無 Phase 4 → 插件停用）。
9. **kill-switch 只看 `replace` 回傳值**：不讀 `__nakiWebSocket.diagnostics()`（v0.1 的靜態測試禁止插件碰 `__nakiWebSocket`）。變長 replace 回 `false` 一次就停本頁面的大廳改寫；原因可能是鎖死、不合規或方法被禁，插件不區分。
10. **補進的角色只寫 `charid` 與 `skin`**：`level`、`exp` 等用 proto3 預設值 0，不猜遊戲要的初始值。
11. **損壞的自家 Account 記 log**：初版把 `account_id` 解不出來的 Account 當成他人靜默略過，測試發現後改為「結構不符」記 log；真正的他人資料仍靜默。
12. **Naki 的 `scripts/plugin-regression.cjs` 不載入本插件**：它只寫死測 tile-highlighter 與 name-hider。派工要求它仍全綠，已跑；本插件與 Naki runtime 的整合另由 `tests/local-unlock-naki.cjs` 覆蓋。

## 驗收（第一輪）

證據在 `naki-plugins/.swfd/logs/unlock-v1/`（主 repo 絕對路徑 `/Users/suoie/Documents/tools/coremltools/naki-plugins/.swfd/logs/unlock-v1/`）：第一輪 `plugin-regression.log`、`plugin-tests.log`、`mutation.log`、`mutate.cjs`；第二輪 `r2-*`。第一輪曾放在 Naki repo `.swfd/logs/unlock-v1/`，已複製過來。

| 項目 | 結果 |
|---|---|
| `NAKI_ROOT=<Naki> node --test tests/*.cjs` | 55／55 通過（local-unlock 38、local-unlock-naki 4、name-hider 7、settings-pages 6） |
| 不設 `NAKI_ROOT` | 51 通過、4 略過 |
| Naki `node scripts/plugin-regression.cjs <本 worktree>` | 38／38 通過 |
| 變異 19 個（守衛拋錯、touch、降級三條件、自家比對、錯誤欄位、去重、kill-switch 等） | 全部被殺；初跑 2 個存活是測試太弱，已補強測試，插件未改 |
| 跨 repo：遊戲收到變長改寫後的 `fetchCharacterInfo` | Naki `reshape` 計數 attempted 1、delivered 1、fallback 0、faults 0 |
| 跨 repo：改寫後 `changeCharacterSkin` | 不外送，遊戲收到 `Error.code = 6` 的本地回應；L3 開著時原因為 `hook_threw` |

## 第二輪（回應 Astra 第一輪：1 擋 6 應修，全採納）

逐條回應與證據：`docs/plan/local-unlock-v1-review-response.md`。

### Deviations（第二輪）

13. **對局內改寫加前提「宿主已污染」，不整個停用**：派工給的保守選項是「無法維持保證就停用對局內等長」。改為只在宿主 `guardState().tainted` 已含本插件全部 19 個守衛方法時才改 `authGame`，其他情況不改。這樣保證與大廳一致（停用、自動移除後由宿主接手），又不必刪掉 v0.1 功能。查不到或不全時 fail-closed。
14. **依賴未記載的 `__nakiPlugins.guardState()`**：契約沒有它，也沒有插件主動污染的 API。宿主日後改動它時，對局內改寫會 fail-closed 停止，不會放寬。列入「待宿主」。
15. **重複 slot 的 `ViewSlot` 仍允許**：Astra 第 3 條針對單值欄位。`views` 是 repeated message，同一 slot 出現多個 `ViewSlot` 時沿用 v0.1（全部等長才改）；單一 `ViewSlot` 內 `slot`、`item_id` 重複則整則不改。
16. **缺 `account_id` 的 Account 改為記 log**：第一輪把它當他人靜默略過；現在要求 `account_id` 恰一筆，否則按結構不符記 log。真正的他人資料仍靜默。
17. **`.gitignore` 是新檔**：repo 原本沒有 `.gitignore`，新增只含 `.swfd/` 一行。master 的工作樹在合併前仍會顯示未追蹤的 `.swfd/`。
18. **盤點的「證明不可能」只到請求欄位層級**（第三輪已取代，見第 19 項）：第二輪的 (c) 以「id 來源回應本插件不改」或「欄位不是 id」為理由，沒有追遊戲客戶端程式碼。

### 待宿主

已由第三輪段落的「待宿主：依 live 證據裁定的候選清單」取代。

### 驗收（第二輪）

| 項目 | 結果 | 證據 |
|---|---|---|
| `NAKI_ROOT=<Naki 8829e99> node --test tests/*.cjs` | 65／65 通過（local-unlock 43、local-unlock-naki 9、name-hider 7、settings-pages 6） | `r2-plugin-tests.log` |
| 不設 `NAKI_ROOT` | 56 通過、9 略過 | 本機重跑 |
| Naki `node scripts/plugin-regression.cjs <本 worktree>` | 38／38 | `r2-plugin-regression.log` |
| 變異 35 個（第一輪 19 個對到新程式，加第二輪 16 個） | 全部被殺；初跑 1 個存活（`ViewSlot` 內 `item_id` 重複），補單測後被殺 | `r2-mutation.log`、`r2-mutate.cjs` |
| 外送入口盤點 | 117 行命中，分 (a) 19、(b) 11 列、(c) 6 類 | `r2-inventory.cjs`、`r2-inventory.txt` |

## 第三輪（回應 Astra 第二輪：0 擋 3 應修 1 建議，全採納）

逐條回應：`docs/plan/local-unlock-v1-review-response.md` 第二輪段。

### Deviations（第三輪）

19. **(c) 只留 schema 層可證明的**：空請求 79 個、bool 欄位 100 個。第二輪以語意或來源推論排除的（背包、活動、開關型 `uint32`、使用者文字、付款）全部移到待查。
20. **盤點改為全部葉欄位**：`r3-inventory.cjs` 遞迴展開 443 個 RPC 請求的全部葉欄位，共 1342 列，不再用關鍵字篩選。(b) 加入 `gameMasterCommand.command` 與 `createRoom.pre_rule`；`openManualItem.select_id` 在待查。(b) 與待查的界線是「是否優先 live 觀察」，兩者都沒有證明。
21. **對局內驗證移到規劃之前**：自家玩家的 `title` 單值、每個 `ViewSlot` 結構完整（含巢狀 field 0）與 `slot`、`item_id` 單值，不論設定改哪一項都先驗；任一不符整則不改。

### 待宿主：依 live 證據裁定的候選清單

宿主 ADR 的 2026-10-17 後續裁決（Naki repo `docs/archive/plan/plugin-v2-b2-adr-2026-10-17.md` 末段「守衛名單擴充與插件主動污染」）：**不立刻擴充守衛名單**，先在 v2.20.0 live 只觀察，依證據決定擴充哪幾個；對局連線守衛延後另案；先做插件主動污染 API 與污染查詢契約（工作包 guard-taint-api）。

1. **守衛名單擴充候選**（待 live 證據裁定，不是確定清單）：設計 §9 (b) 的 Lobby 方法共 14 個，回應型別 field 1 皆為 Error。分別是 `sayChatMessage`、`sendClientMessage`、`clientMessage`、`logReport`、`majClubActivityStartDay`、`majClubActivitySaveRoomData`、`majClubActivityUpgradeCharacterPower`、`majClubActivityUpgradeCharacterTag`、`majClubActivityFinishDay`、`mmoActivityDebugSetTeamCandidate`、`createRoom`、`createCustomizedContest`、`updateManagerCustomizedContest`、`gameMasterCommand`。待查欄位若 live 或離線追值發現帶入補進的 id，再加入候選。擴充後本插件的 `sendGuard` 與 `methods` 同步加上。
2. **對局連線守衛**（宿主延後另案）：`broadcastInGame.content`、`inputGameGMCommand.json_data`。
3. **改用 guard-taint-api**：宿主提供 `ctx.taint()`／`isTainted()` 並寫進契約、合併後，本插件改用它，在任何改寫前先自行標污染，並移除對未記載 `guardState()` 的依賴。本輪不改（尚未合併）。

### 驗收（第三輪）

| 項目 | 結果 | 證據 |
|---|---|---|
| `NAKI_ROOT=<Naki 577caf9> node --test tests/*.cjs` | 66／66（local-unlock 44、local-unlock-naki 9、name-hider 7、settings-pages 6）；不設 `NAKI_ROOT` 時 57 通過、9 略過 | `r3-plugin-tests.log` |
| Naki `plugin-regression.cjs` | 38／38 | `r3-plugin-regression.log` |
| 變異 38 個（第二輪 35 個，加第三輪 3 個驗證順序） | 全部被殺 | `r3-mutation.log`、`r3-mutate.cjs` |
| 新交叉測試在 `d24d115` 的插件上 | 紅（1 失敗），在本輪插件上綠 | 本機重跑 |
| 全葉欄位盤點 | 1342 列：(a) 44、(b) 21、(c) 179、待查 1098 | `r3-inventory.cjs`、`r3-inventory.tsv` |

## 未驗證

- **I2 尚未驗收**：19 個方法的守衛保證不能替代完整驗收；(b) 21 列與待查 1098 列的外送可達性都還沒有證據（Astra 第三輪建議補記）。
- live 全部（等 Naki 2.20.0 發布，由主線另派；只觀察不點擊，前置條件見設計 §10）：大廳畫面效果、補進的角色是否正常顯示、本地錯誤在遊戲的表現、伺服器無同 msgId 回應的外送證明、外送盤點與 v0 設計 §3.7 比對。
- Swift 端 manifest 驗證未實際執行，只讀 `PluginManifest.validate` 的規則比對（`reshapeReceive` 與 `rewriteReceive` 同宣告、`sendGuard` 非空且全為 `.lq.Lobby.*` 並在 `methods`）。
- 舊版 Naki（2.19.0）實際載入本 manifest 的行為：推測忽略 `sendGuard` 與未知 capability 後照常載入，插件判定不支援而不改寫；未在 App 內驗證。
- `ResCharacterInfo`、`Account` 欄位號未用 live 封包核對。
