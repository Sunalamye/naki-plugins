# 本機解鎖 v1：受限 live 觀察計畫

對象：`naki-plugin-ex-local-unlock` 1.0.0（分支 `local-unlock-v1`，HEAD `2f0b500`）。宿主：`/Applications/Naki.app` 2.20.0。依據：Astra 第二輪「live 觀察清單」、設計 §9 待查查法與 §10 前置條件。狀態：**已於 2026-10-17 執行，結果見設計 §11**。

目的是**取證**，不是驗收：看大廳與對局顯示是否如設計，以及改寫後遊戲會不會把改寫過的 id 帶進 19 個守衛方法以外的請求。未觀察到請求只能記「本操作未觀察到」，不等於排除。

## 0. 界線

- 只用測試帳號。允許的外部副作用只有登入、`room_quick_test`、`bot_sync`、`game_vote_game_end`、`room_leave` 與對局中的自動打牌（Naki CLAUDE.md）。
- 不點擊任何會提交的操作：不換裝、不送聊天或好友訊息、不點表情、不開始或儲存活動、不建房或建賽事（`room_quick_test` 除外）。開面板、關面板可以。
- 面板開關只能由用戶手動操作。Naki 禁止座標點擊遊戲畫面；唯一例外是登入畫面的「進入遊戲」鈕（已 live 驗過 `osascript` 點擊）。
- L3 總開關全程關閉：每次讀取都核對 `window.__nakiPluginsMayModifyOutbound` 為假。
- 觀察器只讀：不改 bytes、不送請求、不擋送出。原始 payload 不落盤。輸出只含方法名、欄位路徑、命中與否，不含帳號 id、token、暱稱。
- 停止條件，任一成立立刻跳到 §7 收尾：
  1. 改寫後，非守衛方法的**實際上線**送出命中目標 id 集合（§2），而基準同操作沒有命中。
  2. 守衛方法出現在實際上線的紀錄裡（守衛失效）。
  3. 遊戲出現錯誤彈窗、斷線、被擠下線，或 `reshape.faults` 大於 0。

## 1. 為什麼用帳號已擁有的 id

設定頁的 `characterId`、`skinId`、`titleId` 一律填**帳號已擁有、但目前沒在使用**的 id，不填未擁有的。理由：

1. 要驗的是機制與路徑：變長 replace 被宿主接受、遊戲正確顯示、污染觸發、改寫後的 id 會不會流進其他請求。這些與 id 是否擁有無關，只要 id 與目前狀態不同，就能在送出中被辨認。
2. 若真有未守衛的外送路徑，帶出去的是已擁有的 id，伺服器看到的是合法請求，不構成 I2 所說的「送出未擁有物品」。取證期間的最壞結果因此可接受。
3. 不需要用戶提供任何額外資料，也不用猜不存在的 id（v0.1 live 裁決：不用假 id）。

代價（寫進結果，不能宣稱已驗）：

- 「角色不在清單就補一筆」「皮膚不在 `skins` 就補」兩個分支不會被走到；補入角色的 level 0、無 views 的顯示（Astra 表態 2）仍未驗。
- 零稱號帳號若一個稱號都沒有，`titleId` 無已擁有值可填，大廳稱號這條就不測，填 0。v0.1 live 的測試帳號正是零稱號，須先確認。
- 目標 id 必須避開目前主角色、目前皮膚、目前稱號，否則改寫前後送出無法區分。

id 從何取得：基準階段的觀察器解碼 `fetchCharacterInfo`、`fetchAccountInfo` 回應，只輸出已擁有角色、皮膚、稱號的 id 清單與目前使用中的值。這些是物品 id，不是帳號 id。

## 2. 觀察器

登入前以 `/js` 安裝，安裝內容另存 `.swfd/logs/unlock-v1-live/observer.js`，不放 repo。

- **兩層紀錄**：Proxy `window.WebSocket` 建構子。建構後包住實例的 `send`，記錄「遊戲嘗試送出」（attempt）；同時包住 `WebSocket.prototype.send`，記錄「實際上線」（wire）。Naki 在建構時以 `ws.send.bind(ws)` 綁定原生 send（`naki-websocket.js` 的攔截段），所以只有**登入前**裝好、之後才建立的連線，wire 層才看得到。登入後才裝的只有 attempt 層，不算數。
- **每筆紀錄**：時間、連線 pathname（`/gateway` 或 `/game-gateway`）、層（attempt／wire）、type、msgId、method、payload 長度、資料型別（ArrayBuffer、Blob 等不透明型別記 `opaque`），以及 `hits`。
- **`hits`**：遞迴走 payload 的全部欄位。varint 等於目標集合任一值，記欄位路徑（例如 `2.1`）；length-delimited 能解成訊息就往下走，不能就當字串，十進位子字串命中也記。目標集合是 §1 的 `characterId`、`skinId`、`titleId`，加上它們的十進位字串。
- **不解碼**：`login`、`oauth2Login`、`oauth2Auth`、`oauth2Check`、`emailLogin`、`fastLogin`、`prepareLogin`、`authGame`、`heartbeat`、`loginBeat`，只記方法名與長度。
- **接收側**：對 `fetchCharacterInfo`、`fetchAccountInfo`、`authGame` 回應，在遊戲 listener 之後加一個非 capture listener，記錄遊戲實際收到的值：`main_character_id`、角色數、目標角色是否在清單及其 skin、`skins` 是否含目標、帳號筆數與其 `title`、`avatar_id`、自家 `PlayerGameView` 的 `title`。method 由 attempt 層的 msgId 對回。自家判定只輸出布林，不輸出 id。
- 上限 5000 筆，滿了停止記錄並設旗標。`summary()` 回各方法的 attempt 數、wire 數與命中路徑；`since(mark)` 回某個標記之後的紀錄。

每步共用兩個讀取，結果存檔，檔名見各步：

```bash
curl -s -X POST http://127.0.0.1:8765/js -d 'return JSON.stringify(window.__unlockObs.since(window.__unlockObs.mark("<步驟>")))'
curl -s -X POST http://127.0.0.1:8765/js -d 'const g=window.__nakiPlugins.guardState(), d=window.__nakiWebSocket.diagnostics();
return JSON.stringify({L3:!!window.__nakiPluginsMayModifyOutbound, page:window.__nakiLocalUnlock||null,
tainted:Object.fromEntries(Object.entries(g.tainted).map(([k,v])=>[k,v.length])), guardLog:g.log.slice(-20),
reshape:d.reshape, reshapeLocked:d.reshapeLocked, plugins:window.__nakiPlugins.list()})'
```

## 3. 前置

1. `git -C <naki-plugins-wt-unlock-v1> status --short` 為空，HEAD `2f0b500`。
2. `curl -s http://127.0.0.1:8765/status` 回 2.20.0。`pkill -f 'Naki.app/Contents/MacOS'` 只在需要重啟時用，重啟前確認沒有其他代理在跑 live。
3. 插件目錄 `~/Library/Application Support/Naki/Plugins/` 列檔存 `00-plugins-dir-before.txt`，確認沒有 `naki-plugin-ex-local-unlock`。
4. 用 `plutil -p ~/Library/Preferences/org.39c154f25912233a.akagi.plist` 只列 `plugin.naki-plugin-ex-local-unlock.*` 的鍵與型別，值遮罩後存 `00-prefs-before.txt`。v0.1 live 留下 `enabled`、`testAccountAck`、`titleId` 殘留，啟用後設定頁必須逐欄重填，不能沿用殘留值。
5. 在 Naki 原始碼樹確認 `GUARDABLE_METHODS` 仍是 19 個，且與 `plugin.json` 的 `sendGuard` 相同。

## 4. 基準（插件未安裝）

1. 重載遊戲頁面，停在登入畫面，安裝觀察器，目標集合先留空。
2. 點「進入遊戲」。讀取存 `B1-login.json`。從接收側紀錄取已擁有清單與目前使用值，用戶選定目標 id，記在 `B1-targets.txt`。只記物品 id。
3. 用 `/js` 設定觀察器的目標集合後，從 B2 開始依 §6 的操作表走一輪。每步存 `B<n>-<步驟>.json` 與 `/screenshot` 截圖。
4. 判準：基準中，非守衛方法的 wire 命中次數記為 `baselineHits[method][path]`。基準本身有命中的路徑，例如角色清單查詢，改寫後只比較命中次數的增量。

## 5. 安裝與啟用

1. 複製 `plugins/naki-plugin-ex-local-unlock/` 到 `~/Library/Application Support/Naki/Plugins/naki-plugin-ex-local-unlock/`，`diff -r` 與 worktree 一致，存 `I1-diff.txt`。
2. 重啟 App，手放的目錄要重啟才會 rescan。確認 2.20.0。
3. `/debug/ui {"screen":"plugins"}` 打開插件頁。開關路徑是 `checkbox "啟用" of scroll area 1 of group 2 of splitter group 1 of group 1 of sheet 1`，以 AXPress 操作。不得 `defaults write`。截圖存 `I3-plugins.png`。
4. 打開設定頁，勾「我確認只在測試帳號使用」與「啟用」，填 `characterId`、`skinId`、`titleId`，`views` 留空。自家 `authGame` 若沒有 views，裝扮不測。截圖存 `I4-settings.png`。
5. `/js` 讀 `window.__nakiPluginGrants['naki-plugin-ex-local-unlock']`，只輸出 `capabilities`、`sendGuard.length`，以及各設定的型別與「是否等於目標」布林，存 `I5-grant.json`。判準：含 `reshapeReceive`、`sendGuard` 19、三個 id 都是整數。
6. 重載頁面，停在登入畫面，裝觀察器並設目標集合，點「進入遊戲」。設定變更要重載並重新登入才生效。

## 6. 觀察步驟（基準與改寫後各走一輪，操作相同）

| 步 | 方法與欄位 | 操作與界線 | 要存的欄位 | 判準 |
|---|---|---|---|---|
| S1 大廳回應 | `fetchCharacterInfo` 的 `characters[].charid/skin`、`skins`、`main_character_id`；`fetchAccountInfo` 的 `Account.title/avatar_id` | 登入後不操作，等 30 秒。用戶開關個人資料頁、角色詳情各一次，不套用、不換裝 | 接收側紀錄、`reshape`、`tainted`、`page`、截圖 | 改寫後 `main_character_id` 為目標、目標角色的 skin 為目標皮膚；`reshape.delivered` 至少 1，`fallback` 與 `faults` 為 0；`tainted` 本插件為 19；`page.touched` 為真；畫面主角色與頭像、稱號為目標；角色詳情能開能關 |
| S2 聊天與好友 | `sayChatMessage.content`、`sendClientMessage.type/content` | 用戶開關大廳聊天、好友面板各一次，不輸入、不選表情 | 該時段全部 attempt／wire、截圖 | 有送出就比對 `hits` 與基準；面板列出的表情與基準相同 |
| S3 統計與客戶端訊息 | `logReport.emoji[].id/count`、`clientMessage.message` | 不點選，觀察登入後、S2 面板開關後、等待 3 分鐘、離開對局後四個時點 | 各時點的 `logReport`、`clientMessage` 紀錄 | 是否在無點選下出現；`emoji` 內容是否與基準不同，是否含目標角色衍生的表情 |
| S4 活動 | `majClubActivity*` 的 `character_room_data[].character_id`、`character_id`、`customer_list[].emo`；`mmoActivityDebugSetTeamCandidate` 三組清單 | 只在基準確認開活動頁**不會**自動送 `StartDay`、`SaveRoomData` 之後，改寫後才開頁；看了就關，不開始、不儲存、不升級 | 開頁期間全部紀錄、截圖 | 基準開頁若自動送出上述方法，改寫後**不做這一步**，留待離線追值 |
| S5 建房與賽事 | `createRoom.mode.extendinfo`、`pre_rule`；`createCustomizedContest`、`updateManagerCustomizedContest` 的 `game_rule_setting.extendinfo` | 用戶只開建房與賽事設定面板，不建立、不儲存。`room_quick_test` 送出的 `createRoom` 是 Naki 自送，另列，不算遊戲路徑 | 面板期間紀錄 | 沒有提交就只記「本操作未觀察到」 |
| S6 對局內表情 | `FastTest.broadcastInGame.content`；接收側 `authGame` 自家 `character` 的 `charid/skin/extra_emoji/enabled_emoji` | `room_quick_test` 進人機局，必要時 `bot_sync`。用戶只開關表情面板一次，不點表情。`game_vote_game_end` 結束，`room_leave` | `/game-gateway` 全部紀錄、表情面板截圖、`authGame` 接收側紀錄 | 面板列出的表情與基準相同；`authGame` 角色未被改；`broadcastInGame` 未出現。若出現，比對 `hits`。不點表情排除不了請求建構來源，結論只到「面板顯示」 |
| S7 守衛狀態 | 19 個守衛方法 | 不觸發任何守衛方法 | `guardLog`、`summary()` 中 19 個方法的 attempt／wire | 改寫後 wire 層不得出現任何守衛方法；attempt 層若出現，`guardLog` 應為 `local_error`。真擋無法在 live 安全驗證，不宣稱 |

每步之後讀 `L3` 必須為假。

## 7. 停用與重載後快取（設計 §10.4，Astra 第 7 條）

1. 插件頁 AXPress 關閉本插件，**先停用再重載**，避免重新改寫混淆結果。
2. 重載前讀一次：`plugins` 不含本插件、`tainted` 仍為 19、`page.touched` 為真，存 `C1-before-reload.json`。
3. 重載，停在登入畫面，裝觀察器並設同一目標集合，點「進入遊戲」。
4. 讀 `C2-after-reload.json`：`tainted` 為空、`window.__nakiLocalUnlock` 不存在。接收側的 `fetchCharacterInfo`、`fetchAccountInfo` 與基準相同。截圖確認大廳主角色、頭像、稱號回到基準。
5. 本機儲存掃描，只讀：`localStorage`、`sessionStorage` 的值中目標 id 十進位字串的命中鍵數；`indexedDB.databases()` 的名稱清單。存 `C3-storage.json`。基準階段同樣掃一次（`B-storage.json`），比較增量。
6. 判準：重載後畫面或接收側仍出現目標值，或本機儲存命中數比基準多，即判定有快取窗口。此時記錄並停止角色相關功能的驗收。README 說「要換裝請先停用插件並重新載入頁面」，就是靠這一步成立。

## 8. 收尾

1. 確認插件已停用（`plugins` 不含本插件）。
2. 刪 `~/Library/Application Support/Naki/Plugins/naki-plugin-ex-local-unlock/`。刪前 `diff -r` 與 worktree 一致。插件頁「移除」的確認框不在 AX 樹，按不到，所以直接刪目錄。列檔存 `Z1-plugins-dir-after.txt`，應與 `00-plugins-dir-before.txt` 相同。
3. 重載頁面，`/js` 確認 `window.__unlockObs` 不存在，觀察器隨重載消失。
4. 設定殘留：列 `plugin.naki-plugin-ex-local-unlock.*` 鍵存 `Z2-prefs-after.txt`，值遮罩。不得 `defaults write`；是否清除交主線裁決。
5. 若曾為 live 改跑開發版：關掉後重新啟動 `/Applications/Naki.app`。`/status` 核對 2.20.0，存 `Z3-status.json`。
6. `git -C <naki-plugins-wt-unlock-v1> status --short` 與 Naki repo 的 `git status --short` 不變。

## 9. 結果要回答的問題

| 問題 | 依據 |
|---|---|
| 變長 replace 在 live 被接受、遊戲正確顯示 | S1 |
| 改寫後，非守衛方法的實際上線送出有沒有命中目標集合，且多於基準 | S2–S6 的 wire `hits` 對基準 |
| 面板（聊天、對局表情）有沒有因主角色改寫而列出不同的表情 | S2、S6 截圖對基準 |
| 停用並重載後有沒有快取窗口 | §7 |
| 沒有回答的 | 補入分支（§1 代價）、守衛真擋、(b) 與待查欄位中本輪沒有觸發的請求 |

證據目錄：Naki repo `.swfd/logs/unlock-v1-live/`。原始 frames 不落盤；若除錯需要，只放 scratchpad，結束刪除。
