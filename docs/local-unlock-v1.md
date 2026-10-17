# 本機解鎖插件 v1 設計（`naki-plugin-ex-local-unlock` 1.0.0）

上位設計：`docs/plan/unlock-plugin.md`（以下稱 v0 設計）。Naki 契約：Naki repo `docs/plugin-api-v1.md` 的「v2 Phase 4」段；變長原語設計 `docs/plan/plugin-v2-phase4.md`；送出守衛 `docs/plan/plugin-v2-b2-adr-2026-10-17.md`。實作紀錄：`docs/plan/local-unlock-v1-implementation-notes.md`。

## 1. 範圍

| 功能 | 內容 | 方法 | 改寫方式 |
|---|---|---|---|
| 角色與皮膚 | 大廳主角色改成設定的角色，該角色顯示設定的皮膚；角色不在清單就補一筆，皮膚不在擁有清單就補 | `.lq.Lobby.fetchCharacterInfo` | 變長 |
| 頭像 | 自家個人資料的頭像改成設定的皮膚 | `.lq.Lobby.fetchAccountInfo`（`Account.avatar_id`） | 變長 |
| 稱號（大廳） | 自家個人資料的稱號，含零稱號帳號 | `.lq.Lobby.fetchAccountInfo`（`Account.title`） | 變長 |
| 稱號與裝扮（對局內） | v0.1 原樣：自家 `PlayerGameView` 的 title 與 views | `.lq.FastTest.authGame` | 只等長 |

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

任何結構損壞、wire type 不符、欄位重複出現（單值）或帶 `error`，該則不改並記一行 log。

## 4. 身分

- 自家 `account_id` 取自三個登入回應的 field 2；登出、被擠下線、登入失敗都清掉。v0.1 規則不變。
- `fetchAccountInfo`：`Account.account_id` 必須等於自家 id，否則不改（看他人資料時靜默略過）。
- `fetchCharacterInfo`：請求是 `ReqCommon`，只能查自己；仍要求本頁面已看到登入回應。
- `authGame`：v0.1 規則（登入 id ＝ 請求 `account_id` ＝ 唯一的自家 `PlayerGameView`）。

## 5. I2 與送出守衛

插件不送任何請求，只改 receive。I2 靠兩層：

1. **Naki 污染**：插件宣告 `sendGuard`，在大廳連線上改過一則（等長或變長）即污染到頁面重載；L3 總開關關著時，19 個守衛方法一律改回本地錯誤。
2. **插件自擋**：插件只要成功改過任何一則（含對局內等長），之後收到 19 個守衛方法的 `onSend` 一律拋錯，Naki 判為 `hook_threw` 而本地拒送。這補上「L3 開著時已污染守衛者放行即原樣送出」的情況。旗標掛在 `window`，熱停用再啟用也不重置，頁面重載才清。

不宣稱 I2 全域成立：守衛名單外的方法依 v0 設計 §3.7 外送盤點；送出守衛本身的七項保證限定見 B2 ADR。

## 6. 禮貌降級

每則先檢查 Naki 是否具備 Phase 4 與送出守衛：本插件的 grant 含 `reshapeReceive`、`sendGuard` 含全部 19 個方法，且 `__nakiPlugins.isReshapeForbidden` 存在。任一不成立（Naki 2.19.0 以前會忽略 `sendGuard` 欄位），插件整個不改寫，含對局內等長，並在 log 記一次「需要 Naki 2.20.0 以上」。

## 7. kill-switch

變長 `replace` 回 `false`（頁面已鎖死、Naki 判不合規或方法被禁）時，記一行 log，本頁面不再嘗試任何大廳改寫；對局內等長不受影響，與 Naki 鎖死只停變長的語意一致。重載頁面才恢復。插件不讀 `__nakiWebSocket.diagnostics()`。

## 8. 設定

沿用 v0.1：`enabled`、`testAccountAck` 兩者都為 true 才動作，`titleId`、`views`（對局內）。新增 `characterId`、`skinId`（number，0＝不覆寫），兩者都是有效 id 才生效，只填一個時記 log 並略過角色與頭像。`titleId` 同時用於對局內與大廳。插件不內建任何 id，也不驗證皮膚是否屬於該角色。

## 9. 驗收

- node 單測（假 ctx）：變長 replace 被呼叫且 bytes 正確、非自家不改、無 Phase 4 時停用、守衛方法在改寫後拋錯、replace 被拒後停改大廳。
- 跨 repo（`NAKI_ROOT` 指向 Naki repo 時才跑）：載入 Naki 實際的 `naki-core.js`、`naki-websocket.js`、`naki-plugins.js`，驗證遊戲收到改寫後的回應，且改寫後 `changeCharacterSkin` 不外送、遊戲收到本地錯誤。
- live（未做，等 Naki 2.20.0）：測試帳號上看大廳主角色、頭像、個人資料稱號；換一次未擁有皮膚，確認本地錯誤、伺服器無同 msgId 回應；外送盤點與 v0 設計 §3.7 比對。
