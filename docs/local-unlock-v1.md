# 本機解鎖插件 v1 設計（`naki-plugin-ex-local-unlock` 1.0.0）

上位設計：`docs/plan/unlock-plugin.md`（以下稱 v0 設計）。Naki 契約：Naki repo `docs/plugin-api-v1.md` 的「v2 Phase 4」段；變長原語設計 `docs/plan/plugin-v2-phase4.md`；送出守衛 `docs/plan/plugin-v2-b2-adr-2026-10-17.md`。實作紀錄：`docs/plan/local-unlock-v1-implementation-notes.md`。

## 1. 範圍

| 功能 | 內容 | 方法 | 改寫方式 |
|---|---|---|---|
| 角色與皮膚 | 大廳主角色改成設定的角色，該角色顯示設定的皮膚；角色不在清單就補一筆，皮膚不在擁有清單就補 | `.lq.Lobby.fetchCharacterInfo` | 變長 |
| 頭像 | 自家個人資料的頭像改成設定的皮膚 | `.lq.Lobby.fetchAccountInfo`（`Account.avatar_id`） | 變長 |
| 稱號（大廳） | 自家個人資料的稱號，含零稱號帳號 | `.lq.Lobby.fetchAccountInfo`（`Account.title`） | 變長 |
| 稱號與裝扮（對局內） | v0.1 原樣：自家 `PlayerGameView` 的 title 與 views；只在 Naki 已因本插件的大廳改寫而污染後才做（§5） | `.lq.FastTest.authGame` | 只等長 |

不做：他人外觀、對局內角色與皮膚（v0 設計 F1，表情面板經 `broadcastInGame` 外送，攔不住）、大廳裝扮（F5，擁有來源未確認）、稱號清單（`fetchTitleList` 不在 Phase 4 允許清單）、加載 CG、語音、星標。`ActionPrototype` 與任何 `.lq.FastTest.*` 一律不變長。

**對局內零稱號仍不生效**：`.lq.FastTest.*` 在變長禁改名單內，`authGame` 只能等長；零稱號帳號的 title 是 1 byte，對局內稱號照舊略過。

## 2. 用到的 method

變長 replace 只用兩個，皆在 Phase 4 §4 的允許清單內，且不在禁改名單：

1. `.lq.Lobby.fetchCharacterInfo`（RESPONSE）
2. `.lq.Lobby.fetchAccountInfo`（RESPONSE）

另外兩個允許方法不用：`fetchAccountCharacterInfo` 的 `unlock_list` 語意未確認；`fetchAllCommonViews` 是大廳裝扮，v0 設計 F5 預設關閉。

唯讀或等長：`.lq.Lobby.login`、`oauth2Login`、`emailLogin`（讀 `account_id`）、`.lq.NotifyAnotherLogin`、`.lq.NotifyAccountLogout`（重置身分）、`.lq.FastTest.authGame`（REQUEST 唯讀、RESPONSE 等長）。

送出守衛（`sendGuard`）：Naki 的 19 個 `GUARDABLE_METHODS` 全部宣告：`changeCharacterSkin`、`changeMainCharacter`、`changeAvatar`、`useTitle`、`setRandomCharacter`、`updateCharacterSort`、`setHiddenCharacter`、`changeCharacterView`、`changeCommonView`、`saveCommonViews`、`useCommonView`、`setLoadingImage`、`sendGiftToCharacter`、`upgradeCharacter`、`addFinishedEnding`、`receiveEndingReward`、`receiveCharacterRewards`、`mmoActivitySetCharacter`、`mmoActivitySetTeamMember`（皆 `.lq.Lobby.` 前綴）。

## 3. 編碼方法

沿用 v0.1 的 varint 讀取與欄位走訪，不整包解碼再序列化。每層訊息以「欄位為單位」重組：要改的欄位換成新編碼，其餘欄位的原始位元組照抄，再由內往外重算長度前綴，最外層只換 envelope 的 field 2。

- 單值欄位（`main_character_id`、`title`、`avatar_id`、`Character.skin`）：移除所有出現處，在該訊息尾端寫一筆。
- 重複欄位（`skins`）：不存在才在尾端補一筆非 packed 元素；packed 與非 packed 都讀得懂。
- 角色：清單內已有就原地換那一筆的 `skin`，沒有就在尾端補 `{charid, skin}`。
- 欄位順序改變、repeated 混用 packed 與非 packed，都是 proto3 合法形態（契約 §4 三種變形）。
- envelope 的 header（type、msgId）與 field 1 原樣保留；Naki 會再檢查 type、msgId、method 不變與欄位界內。

提交 `replace` 前完整驗證，任一不符整則不改並記一行 log：結構損壞（含 field 0）、wire type 不符、帶 `error`、單值欄位重複（`main_character_id`、每個 `Character` 的 `charid` 必須恰一筆與 `skin`、`Account` 的 `account_id` 必須恰一筆與 `title`、`avatar_id`、對局內的 `title` 與 `ViewSlot` 的 `slot`、`item_id`）。清單內任何一個 `Character` 損壞，即使不是目標角色，也整則不改。驗證在規劃改寫之前做完，與設定要改哪一項無關：例如只改裝扮時，自家稱號重複仍整則不改。

## 4. 身分

- 自家 `account_id` 取自三個登入回應的 field 2。回應帶 `error`（field 1）時一律清掉身分，即使同時帶 `account_id`。登出、被擠下線也清掉。
- `fetchAccountInfo`：`Account.account_id` 必須等於自家 id，否則不改（看他人資料時靜默略過）。
- `fetchCharacterInfo`：請求是 `ReqCommon`，只能查自己；仍要求本頁面已看到登入回應。
- `authGame`：請求的 `account_id` 以 (socketId, msgId) 保存，回應以同一組鍵取出並消耗；配不到就不改。登入 id ＝ 配對到的請求 `account_id` ＝ 唯一的自家 `PlayerGameView`。回應帶 `error` 不改。

## 5. I2 與送出守衛

插件不送任何請求，只改 receive。I2 靠兩層，保證範圍如下：

1. **Naki 污染**：插件宣告 `sendGuard`，在大廳連線上改過一則即被污染到頁面重載。污染活在宿主，插件停用、自動移除、熱重載都不解除。L3 關著時，19 個守衛方法改回本地錯誤；插件不在鏈上時（停用、自動移除）以 `not_on_chain` 擋下，不論 L3。
2. **插件自擋**：插件只要成功改過任何一則，之後守衛方法的 `onSend` 一律拋錯，Naki 判 `hook_threw` 本地拒送。這補上「L3 開著、已污染守衛者在鏈上並放行」時會原樣外送的情況。旗標與大廳鎖都掛在 `window.__nakiLocalUnlock`，熱停用再啟用不重置。
3. **對局內只在已污染後改**：宿主只污染大廳連線，`authGame` 的等長改寫不會觸發污染。插件因此在改 `authGame` 前查宿主的 `__nakiPlugins.guardState().tainted`，本插件的 19 個守衛方法都已污染才改；查不到或不全就不改。這樣停用或自動移除後，守衛仍由宿主接手。`guardState` 不在契約內，記在「待宿主」。

宿主沒有「插件主動污染」的 API，所以第一次大廳改寫本身就是污染的觸發點；改寫被拒（`replace` 回 `false`）時宿主不污染、插件也不設旗標，畫面沒有變。

**未守衛的外送入口（§9）**：19 個守衛方法之外的請求都沒有證明，I2 尚未驗收。宿主依 live 證據擴充守衛名單前，這些入口不在保證內；live 只觀察、不點擊。

## 6. 禮貌降級

每則先檢查 Naki 是否具備 Phase 4 與送出守衛：本插件的 grant 含 `reshapeReceive`、`sendGuard` 含全部 19 個方法，且 `__nakiPlugins.isReshapeForbidden` 存在。任一不成立（Naki 2.19.0 以前會忽略 `sendGuard` 欄位），插件整個不改寫，含對局內等長，並在 log 記一次「需要 Naki 2.20.0 以上」。

## 7. kill-switch

變長 `replace` 回 `false`（頁面已鎖死、Naki 判不合規或方法被禁）時，記一行 log，本頁面不再嘗試任何大廳改寫。鎖存在 `window.__nakiLocalUnlock.lobbyLocked`，熱停用再啟用不重置，重載頁面才恢復。插件不讀 `__nakiWebSocket.diagnostics()`。

宿主的交付故障（D10）在 `replace` 回 `true` 之後才發生，插件看不到；但宿主已在交付前污染，之後的變長 `replace` 回 `false`，插件就停改大廳。整合測試以遊戲 listener 拋錯重現（`faults` 1、`reshapeLocked`）。

## 8. 設定

沿用 v0.1：`enabled`、`testAccountAck` 兩者都為 true 才動作，`titleId`、`views`（對局內）。新增 `characterId`、`skinId`（number，0＝不覆寫），兩者都是有效 id 才生效，只填一個時記 log 並略過角色與頭像。`titleId` 同時用於對局內與大廳。插件不內建任何 id，也不驗證皮膚是否屬於該角色。

## 9. 外送入口盤點

來源：Naki repo `docs/protocol/liqi.json`（2026-10-17 重抽）的 Lobby、FastTest、Route 全部 443 個 RPC 請求。每個請求遞迴展開巢狀訊息到**全部葉欄位**，不再用關鍵字篩選，逐一分類。腳本與完整輸出（附錄）：`naki-plugins/.swfd/logs/unlock-v1/r3-inventory.cjs`、`r3-inventory.tsv`（1342 列，欄位依序為分類、方法、欄位路徑、型別）。只涵蓋 RPC 請求；非 RPC 的送出不在 schema 內，靠 live 觀察。

| 分類 | 定義 | 葉欄位 | 方法 |
|---|---|---|---|
| (a) | 方法在 19 個守衛內 | 44 | 19 |
| (b) | 不在守衛內、優先 live 觀察的候選 | 21 | 16 |
| (c) | schema 層可證明帶不了 id：空請求 79 個、bool 欄位 100 個 | 179 | — |
| 待查 | schema 證明不了賦值來源 | 1098 | 339（Lobby 331、FastTest 5、Route 3） |

**I2 尚未驗收**：(b) 與待查合計 1119 個葉欄位沒有證明。在 live 證據或離線追值完成前，不宣稱這些入口不會帶入補進的 id；README 的保證範圍不能替代 I2 驗收。

**(a)**：`changeAvatar`、`useTitle`、`setRandomCharacter`、`updateCharacterSort`、`changeMainCharacter`、`changeCharacterSkin`、`changeCharacterView`、`setHiddenCharacter`、`sendGiftToCharacter`、`changeCommonView`、`saveCommonViews`、`useCommonView`、`upgradeCharacter`、`addFinishedEnding`、`receiveEndingReward`、`receiveCharacterRewards`、`setLoadingImage`、`mmoActivitySetCharacter`、`mmoActivitySetTeamMember`。

**(b)**：

| 入口 | 葉欄位 | 可能帶入的途徑 | 宿主可守衛 |
|---|---|---|---|
| `.lq.Lobby.sayChatMessage` | `content` | 大廳聊天若有依主角色產生的表情或貼圖 | 可（`ResCommon`，field 1 為 Error） |
| `.lq.Lobby.sendClientMessage` | `type`、`content` | 好友訊息、邀請內容可能帶角色或表情 | 可 |
| `.lq.Lobby.clientMessage` | `message` | 客戶端回報字串，內容未知 | 可 |
| `.lq.Lobby.logReport` | `emoji.id`、`emoji.count` | 表情使用統計，可能依主角色的表情集合產生 | 可 |
| `.lq.Lobby.majClubActivityStartDay`、`majClubActivitySaveRoomData` | `character_room_data.character_id` | 活動角色候選可能取自角色清單 | 可 |
| `.lq.Lobby.majClubActivityUpgradeCharacterPower`、`majClubActivityUpgradeCharacterTag` | `character_id` | 同上 | 可 |
| `.lq.Lobby.majClubActivityFinishDay` | `customer_list.emo` | 推測是活動 NPC 情緒；未證明 | 可 |
| `.lq.Lobby.mmoActivityDebugSetTeamCandidate` | 三組清單的 `character_id` | 推測是除錯入口；未證明 | 可 |
| `.lq.Lobby.createRoom` | `mode.extendinfo`、`pre_rule` | 規則字串，內容未知 | 可 |
| `.lq.Lobby.createCustomizedContest`、`updateManagerCustomizedContest` | `game_rule_setting.extendinfo` | 同上 | 可 |
| `.lq.Lobby.gameMasterCommand` | `command` | GM 指令字串，與對局 GM 入口同標準；推測正常客戶端不送 | 可 |
| `.lq.FastTest.broadcastInGame` | `content` | 對局內表情；本插件不改 `authGame` 角色，但面板可能用大廳共享的角色模型（未證明） | **不可**：守衛只在大廳連線 |
| `.lq.FastTest.inputGameGMCommand` | `json_data` | 推測 GM 指令；未證明 | **不可** |

**(c)**：只收 schema 本身能證明的兩種。其一是空請求（例如 `ReqCommon`），沒有欄位可帶值。其二是 bool 欄位，只有真假兩值。其餘以語意或「id 來源的回應本插件不改」推論的排除，第二輪曾列為 (c)，本輪全部移到待查。`emoji_switch`、`disable_random_char` 這類開關是 `uint32`，schema 不限值域，也在待查。

**待查**：包含背包與道具（例如 `openManualItem.item_id`、`select_id`）、活動、建房其餘欄位、簽名與留言文字、付款資料，以及其他所有不屬於 (a)(b)(c) 的葉欄位。查法二選一：

1. **live 觀察**：未改寫基準與改寫後各錄一次送出，只觀察、不點擊會提交的操作，比對欄位值是否落在補入集合（設計 §10）。沒有觀察到請求，只能記「本操作未觀察到」，不等於排除。
2. **離線追值**：從遊戲客戶端程式追該欄位的賦值來源，證明不讀 `fetchCharacterInfo`、`fetchAccountInfo` 或共享的角色、表情模型。

(b) 與待查的宿主守衛擴充，依 live 證據裁定（notes「待宿主」）。

## 10. 驗收

- node 單測（假 ctx）：變長 replace 被呼叫且 bytes 正確、非自家不改、無 Phase 4 時停用、守衛方法在改寫後拋錯、replace 被拒後停改大廳、重複欄位與損壞角色整則不改、error 優先、(socketId, msgId) 配對、未污染不改對局內、頁面鎖跨熱重載、對局內驗證不隨設定分支。
- 跨 repo（`NAKI_ROOT` 指向 Naki repo 時才跑）：載入 Naki 實際的 `naki-core.js`、`naki-websocket.js`、`naki-plugins.js`。涵蓋變長交付、守衛拒送與本地錯誤、L3 開著、舊 grant、只有對局內設定時不改、熱停用與再啟用、自動移除、錯序配對、D10 交付故障。
- live（未做，等 Naki 2.20.0）前置條件：
  1. 只觀察、不點擊：看大廳主角色、個人資料頭像與稱號，以及補入角色的顯示、角色詳情與面板開關（表態 2，不猜填初始值）。
  2. 只開聊天與表情面板、不點表情：確認不列出未擁有角色的表情；若列出且沒有可靠攔截，角色功能不得放行（表態 5）。
  3. 大廳與對局連線都記錄全部送出，含未解析與非 RPC 的；先錄未改寫基準，再錄改寫後，逐欄比對 §9 (b) 與待查欄位的值是否落在補入集合，不點擊會提交的操作。
  4. 重載頁面後確認遊戲不再顯示改寫資料（快取窗口，Astra 第 7 條，目前沒有證據）。
