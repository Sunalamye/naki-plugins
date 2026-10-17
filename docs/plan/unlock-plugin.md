# 本機解鎖插件設計（`naki-plugin-ex-local-unlock`）

**資料日期**：2026-10-14（第二版：依 Astra 14 條審查修訂，回應見 `docs/plan/unlock-plugin-review-response.md`）
**狀態**：v0.1 已實作（未 live 驗證，未發布）。本文件只有設計，沒有插件程式碼。
**基準**：本 repo `c35e61d`；Naki main `910c51c`（App 2.18.0）。
**決策紀錄**：`docs/plan/unlock-plugin-implementation-notes.md`（含 Deviations）。
**證據檔**（Naki 主 repo `.swfd/logs/unlock-design/`）：`evidence.txt`（liqi.json 欄位、禁改名單、原語有無）、`outbound-inventory.txt`（Lobby／FastTest 中請求欄位含外觀相關 id 的入口）。下文「證據檔」指前者，「外送盤點」指後者。
**上位文件**（Naki repo）：`docs/plugin-api-v1.md`、`docs/plan/plugin-v2.md`、`docs/plan/plugin-v2-adr-2026-10-14.md`、`docs/plugin-system-design.md` §8／§9。本文件與它們衝突時以它們為準。

---

## 0. 授權與原創

- 本插件以 **CC0-1.0** 釋出，與本 repo 既有三個插件相同（各插件 `plugin.json` 的 `license`）。
- 不使用、不改寫 MajsoulMax（GPL-3.0）的任何程式碼、規則表、id 對照、設定預設值。功能清單只取自 Naki 已查證的 README 轉述（`plugin-system-design.md` §2）；本工作包沒有上網。
- 插件不內建任何 id。id 只有三個來源：使用者輸入、遊戲自己的回應封包、遊戲自己下載的設定表（§2.3）。設定的 `default` 一律是 0、空字串或空物件。
- 依據：`plugin-system-design.md` §9.3、§9.4；`plugin-v2.md` §12.4 第 3 點。

---

## 1. 目標與明確不做

**目標**：只在使用者這台裝置上，讓遊戲畫面顯示帳號沒有擁有的外觀。伺服器與其他玩家看到的仍是帳號實際擁有的外觀。

**首要條件**：伺服器不得收到任何「使用或擁有未擁有物品」的請求（§4 I2）。任何功能只要找到一條會外送這種請求、而插件攔不住的路徑，就縮小或關閉，不以警語代替。

| # | 功能 | 決定 | 理由 |
|---|---|---|---|
| F1 | 對局內自家角色、皮膚、頭像 | **v0.1b**（有前置） | 推測遊戲的對局內表情面板依角色資料產生。改角色或皮膚後，若面板列出未擁有的表情，使用者一點就經 `.lq.FastTest.broadcastInGame` 外送，而 `.lq.FastTest.*` 是送出禁改範圍，插件攔不住（§3.7）。前置：live 不點擊確認面板來源（§7.2），並有目錄驗證角色與皮膚的從屬（§3.8） |
| F2 | 對局內自家裝扮，限已存在的 slot | **v0.1** | 對局內唯一可能帶外觀資料的外送是 `broadcastInGame`，與裝扮無關（§3.7） |
| F3 | 對局內自家稱號，限欄位已存在**且帳號已持有至少一個稱號**（2026-10-17 live：零稱號帳號 title 為 1 byte，等長改寫不可能） | **v0.1** | 同 F2 |
| F4 | 大廳角色、皮膚、頭像、主角色 | **v1** | 要在 repeated 欄位補元素（變長），並攔下換裝類請求 |
| F5 | 大廳裝扮 | **v1 預設關閉** | 擁有清單的來源未確認；推測裝扮在背包裡，補進背包會讓出售、使用類請求可達（§3.7）。來源確認且不必改背包時才開 |
| F6 | 稱號 | **v1** | 擁有清單有完整快照與增刪差量（§3.3） |
| F7 | 加載 CG | **v1 預設關閉** | `Account.loading_image` 是「已選用」不是「已擁有」，擁有清單的來源未確認（§3.3） |
| F8 | 語音 | **v1 預設關閉** | 控制可聽語音的欄位未確認 |
| F9 | 星標角色 | **v1** | 只涉及排序與隱藏陣列，本地回應即可（§3.6） |
| F10 | 表情 | **不做** | 表情經 `broadcastInGame` 送給所有人，攔不住 |
| F11 | 強制便捷提示 | **不做** | 影響對局判斷；推測在 `authGame.game_config`，屬 `players`／`robots` 以外的禁改欄位（`plugin-api-v1.md` §7） |
| F12 | 自訂名稱 | **不做** | Swift 從 `players[].nickname` 產生名字（`LiqiParser.parsePlayerGameView`）；截圖可能誤導他人 |
| F13 | 顯示所在伺服器 | **不做** | 不是解鎖；需要造公告或疊 DOM |
| F14 | 主播／Pro 標識 | **不做** | 官方身分標記，截圖可冒充身分 |
| F15 | 地鐵模式 | **不做** | 查不到功能描述（Deviations D1） |

---

## 2. 所需原語與現況

### 2.1 Naki 原語現況（main `910c51c`）

| 代號 | 原語 | 現況 | 證據 |
|---|---|---|---|
| P1 | 等長 receive 改寫（`rewriteReceive`） | **已有** | `naki-plugins.js` `makeCtx`；`plugin-api-v1.md` §4 |
| P2 | `rewriteSend`（L3） | **已有**（2.18.0），本插件不用 | `naki-plugins.js` 6 處（證據檔）。`plugin-api-v1.md` 仍寫未實作，是文件漂移 |
| P3 | 變長 receive `replace` | **未實作**，卡 Phase 4 probe | `plugin-v2.md` §4.2、§9 |
| P4 | `respondLocally` | **未實作**，卡 Phase 4 probe | `plugin-v2.md` §4.3；`command/` 0 處 |
| P5 | `injectReceive`、receive `drop` | **未實作**，本插件不用 | `plugin-v2.md` §4.2 |
| P6 | `window.__nakiProto`（PV2-C） | **未實作** | `plugin-v2.md` §12.3；`command/` 0 處 |
| P7 | `json` 設定型別 | **未實作** | `PluginRegistry.swift` 只有三個 case |
| P8 | `settingsUI` | **已有**；App 內顯示未驗證 | `PluginRegistry.swift`；`plugin-v2.md` §7 |
| P9 | `onSettingsChanged` | **未實作** | `command/` 0 處 |
| P10 | 送出守衛（停用後仍有效、攔截失敗時不送出） | **不存在**，本設計提出（§3.5、§3.6、§8.2 N1／N2） | 現行 hook 拋錯一律撤回改動、原樣送出（`naki-plugins.js` dispatch 的 fail-open 段）；插件被停用即從派發中移除（`disable`、`noteFailure` 達 `FAILURE_LIMIT` 時 `registry.delete`） |

### 2.2 功能 × 原語矩陣

✔＝必須；○＝建議；—＝不需要。

| 功能 | P1 | P3 | P4 | P6 | P7 | P8 | P9 | P10 | 其他前置 | 版本 |
|---|---|---|---|---|---|---|---|---|---|---|
| F2、F3 對局內裝扮、稱號 | ✔ | — | — | — | — | ○ | — | — | N7 等價測試 | v0.1 |
| F1 對局內角色、皮膚、頭像 | ✔ | — | — | — | — | ✔ | — | — | v0.2 目錄；表情面板 live 確認；N7 | v0.1b |
| F4 大廳角色、皮膚、頭像 | ○ | ✔ | ✔ | ✔ | ✔ | ✔ | ○ | ✔ | N3 大廳 probe；錯誤回應 live 確認 | v1 |
| F6 稱號 | ○ | ✔ | ✔ | ✔ | ✔ | ✔ | ○ | ✔ | 同 F4 | v1 |
| F9 星標 | — | ✔ | ✔ | ✔ | ✔ | ✔ | ○ | ✔ | 同 F4 | v1 |
| F5 大廳裝扮 | ○ | ✔ | ✔ | ✔ | ✔ | ✔ | ○ | ✔ | 擁有來源確認；不改背包 | v1 預設關 |
| F7 加載 CG | ○ | ✔ | ✔ | ✔ | ✔ | ✔ | ○ | ✔ | 擁有來源確認 | v1 預設關 |
| F8 語音 | ○ | ✔ | — | ✔ | ✔ | ✔ | ○ | — | 控制欄位確認 | v1 預設關 |

**PV2-B2、PV2-C 與 P10 完成前完全不能做**：F4–F9。P10 是本次審查後新增的硬性前置：沒有它，現行契約無法保證停用、拋錯或 `respondLocally` 被拒時不漏送（§3.5、§3.6）。

### 2.3 id 資料來源盤點

| # | 來源 | 提供 | 狀態 |
|---|---|---|---|
| S1 | `fetchCharacterInfo` 回應 `ResCharacterInfo`；`fetchInfo` 回應 field 27 | **擁有的**角色、皮膚、主角色、排序、隱藏 | 欄位定義已讀（證據檔）；實際送哪一個、欄位號是否正確：**需 live** |
| S1b | `fetchAccountCharacterInfo` 回應 `ResAccountCharacterInfo.unlock_list` | 推測是擁有角色清單 | 欄位定義已讀；語意**未驗證** |
| S2 | `ResLogin.account`、`ResAccountInfo.account` | 自家 `avatar_id`、`title`、`loading_image`（已選用值，**不是**擁有清單） | 欄位定義已讀；**需 live** |
| S3 | `ResTitleList`；`ResFetchInfo` field 10；`AccountUpdate.TitleUpdate{new_titles, remove_titles}` | 擁有的稱號，含增刪差量 | 欄位定義已讀；**需 live** |
| S4 | `ResBagInfo`；`AccountUpdate.BagUpdate` | 擁有的道具（推測含裝扮） | 裝扮是否在背包**未驗證** |
| S5 | `authGame.players`、`NotifyRoomPlayerUpdate` | 同桌玩家外觀 | 零星樣本，不當目錄、不當擁有 |
| S6 | 遊戲 CDN `lqc.lqbin` | 全目錄：`item_definition.skin` 488 列、`.view` 450 列、`.item` 1,093 列 | 2026-08-01 下載並解析成功：**已驗證**（Naki `docs/majsoul-config-tables.md`）。角色與稱號的 sheet 名稱、Unity 客戶端是否仍讀它、設定頁能否跨域抓取：**未驗證** |
| S7 | Unity asset bundle | 推測含全目錄 | **未驗證** |
| S8 | wasm heap | 推測含設定表 | **未驗證**，不採用 |
| S9 | 使用者手動輸入 | 任何 id | 永遠可用 |

S1–S5 做不出全目錄；目錄只能來自 S6（或日後的 S7），不成立就退回 S9，不改成硬寫清單。擁有清單的規則見 §3.3。

---

## 3. 資料流與狀態規則

### 3.1 一輪完整流程：換皮膚（v1）

receive 側禁改名單是 `.lq.ActionPrototype`、`.lq.FastTest.syncGame`、`.lq.NotifyGameEndResult`，加上文件規則「`authGame` 只准改 `players`／`robots`」（JS 未強制，證據檔）。send 側是非 `.lq.Lobby.*` 一律禁，加上 35 個登入、session、付費、配對方法（證據檔）。本流程每一步都不觸及禁改名單，也都不需要 `rewriteAllow`（送出側本來就解不開，`plugin-v2.md` §4.4）。

| 步 | 方向 | method | 插件動作 | 原語 |
|---|---|---|---|---|
| 1 | receive | 登入回應（`login`／`oauth2Login`／`emailLogin`） | 取 `account_id` 作為自家身分，開始新的登入世代（§3.4）。只等長就地改 `account.avatar_id`，不整包重編（含 `access_token`；Swift 也從這裡取 `account_id`，`LiqiParser.loginResponseMethods`） | P1 |
| 2 | receive | `fetchInfo`（field 27）或 `fetchCharacterInfo` 回應 | 先從**未經其他插件改過的** bytes 記下擁有清單（§3.3、§3.4），再補入未擁有的角色與皮膚、套用覆寫 | P3＋P6 |
| 3 | receive | `fetchAccountInfo` 回應 | 只有 REQUEST 的 `account_id` 與回應的 `account.account_id` 都等於自家身分時才改 `avatar_id`、才學習；否則不改不學 | P1 |
| 4 | send | `changeCharacterSkin` | 依 §3.6 判定：能證明擁有就放行；證明不了就本地回應；本地回應做不到就由 P10 以錯誤回應代替送出 | P4、P10 |
| 5 | receive | 合成回應 | Naki 交給遊戲與 Swift；Swift 對它只解析不寫狀態（`plugin-v2.md` §4.3） | — |
| 6 | receive | `NotifyAccountUpdate` | 先用它更新擁有清單（§3.3），再只把 `character`／`main_character` 子欄位改成覆寫值；不 drop | P3＋P6 |
| 7 | receive | `.lq.FastTest.authGame` 回應 | F1 開啟時才改自家那筆，規則見 §3.8 | P1 |
| 8 | — | — | 設定持久化見 §3.9 | P7、P9 |

### 3.2 為什麼用 `respondLocally`，不用 `rewriteSend`

| 比較 | `rewriteSend` 改成 `loginBeat` | `respondLocally` |
|---|---|---|
| 伺服器收到什麼 | 一筆時機不規律、沿用遊戲 msgId 的心跳；`contract` 要填什麼未驗證 | 什麼都沒收到 |
| 回應形狀 | `ResCommon`，與原方法相同（`plugin-v2.md` §8 第 3 點） | 合成 `ResCommon` |
| 遊戲是否當成成功 | 需 live | 需 live |
| 可用時間 | 現在 | PV2-B2 之後 |

選 `respondLocally`。大廳解鎖必須先有變長改寫（P3），P3 與 P4 **共享同一個 Phase 4 前置 gate**，所以 `rewriteSend` 不會讓大廳功能更早交付，只多一筆伺服器看得到的異常。P3 與 P4 仍各有自己的端到端驗收（§7.5），一個通過不代表另一個通過。

### 3.3 擁有清單（`owned`）的規則

每一類各自有狀態：`unknown`（本世代還沒收到完整快照）或 `complete`。**一類的解鎖改寫只在該類為 `complete` 時進行**；`unknown` 時不補入任何未擁有項目，遊戲 UI 只看得到伺服器給的東西。

| 類別 | 完整快照 | 差量 | 刪除規則 | 狀態 |
|---|---|---|---|---|
| 角色 | `ResCharacterInfo.characters`（S1） | `CharacterUpdate.characters` 加入 | schema 沒有刪除欄位；每次收到完整快照就**整份取代**，不與舊集合合併 | v1 可用 |
| 皮膚 | `ResCharacterInfo.skins` | `CharacterUpdate.skins` 加入 | 同上 | v1 可用 |
| 頭像 | 推測頭像就是皮膚 id，沿用皮膚清單 | — | — | 推測；不成立時頭像類請求一律走本地回應 |
| 稱號 | `ResTitleList.title_list`（S3） | `TitleUpdate.new_titles` 加入、`remove_titles` 移除 | 完整快照整份取代 | v1 可用 |
| 裝扮 | **未確認**（推測 S4） | — | — | `unknown` 固定，F5 關 |
| 加載 CG | **未確認**；`Account.loading_image` 是已選用值，不得當擁有清單 | — | — | `unknown` 固定，F7 關 |

擁有清單只由伺服器回應更新，**絕不**由插件的覆寫、本地回應或其他插件改過的 bytes 寫入（§3.4）。

### 3.4 身分、世代與資料來源的真實性

- **自家身分**：以登入回應的 `account_id` 為準。`authGame` REQUEST 的 `account_id` 必須相同；不同或任一缺失時，本世代所有類別回到 `unknown`，對局內改寫停止。
- **登入世代**：每次收到登入回應、`NotifyAnotherLogin`、`NotifyAccountLogout`，就開新世代：所有類別回到 `unknown`，`sessionOverrides` 清空。頁面重載自然是新世代。有 `onSocketClose`（PV2-B1 剩餘）時，大廳連線關閉也開新世代。
- **其他改寫插件**：Naki 讓後面的插件看到前面插件改過的 bytes（`plugin-api-v1.md` §7）。本插件從這些 bytes 學擁有清單，可能把別的插件補入的項目當成擁有。規則：每次學習前讀 `window.__nakiPluginGrants`（只含已啟用插件：`setGrant` 寫入、`disable` 刪除，`naki-plugins.js`），只要有其他插件對本插件白名單內任一 method 持有 `rewriteReceive` 或 PV2-B2 的改寫 capability，對應類別就固定為 `unknown`，並在設定頁顯示「與某插件衝突，解鎖已停用」。這是防誤用，不防惡意插件（U4）。Naki 若提供改寫前的原始 bytes（§8.2 N9），改用它學習並取消這條限制。

### 3.5 撤銷：停用、撤回確認、關掉 L3

**問題**：大廳一旦載入了補入的未擁有項目，遊戲 UI 會一直顯示它們到頁面重載。插件或攔截在這之前消失，使用者下一次換裝就會原樣送出。

**定義**：本頁面中插件**第一次對大廳回應補入未擁有項目**起，頁面進入「已污染」狀態，直到頁面重載。

| 撤銷方式 | 已污染時的處置 | 誰負責 |
|---|---|---|
| 設定頁撤回 `testAccountAck` 或關掉 `enabled`、關掉某個功能 | 插件停止新的改寫，但**守衛不解除**：§3.6 的送出判定照常執行到頁面重載 | 插件 |
| 存設定觸發熱重載（停用再重跑源碼，`PluginRegistry.enableScript`） | 停用、設 grant、重跑源碼在同一段腳本內完成（推論：同一段腳本執行期間不會插入 message 事件）。重跑後本世代視為 `unknown`，換裝類請求一律本地回應。源碼重跑拋錯時插件會停在停用狀態，由 N1 接手 | 插件＋N1 |
| 使用者在插件頁停用插件、插件因連續失敗被自動停用 | 插件已不在派發鏈上，**插件無法處理**。需要 Naki 的送出守衛 N1：守衛方法在頁面重載前都不送出，改由 Naki 回錯誤回應 | Naki（N1） |
| 關掉 L3 總開關 | `respondLocally` 會被拒（`plugin-v2.md` §4.5 第 7 點）。需要 N1 規定：守衛的錯誤回應**不送出任何東西**，不受 L3 開關限制 | Naki（N1） |
| 頁面重載 | 遊戲重新從伺服器取資料，污染解除，守衛跟著解除 | — |

Naki 的插件頁對已污染的插件停用時，應提示「需重新載入頁面才完全撤銷」，並提供重載按鈕（對局中不重載）。只有警語不足以取代 N1。

### 3.6 送出側判定（fail-closed）

**守衛方法**：§3.7 標為「攔截」的大廳方法。對每一筆守衛方法的 REQUEST：

1. 解析 payload。解析失敗、wire type 不符、欄位數量異常 ⇒ **證明不了擁有**。
2. 依下表檢查。所有被引用的 id 都在 `complete` 的擁有清單內 ⇒ 放行（帳號真的換裝）。
3. 否則 ⇒ 依下表「證明不了時」欄處置。
4. 插件拋錯、`respondLocally` 被拒、回應建構失敗、插件不在鏈上 ⇒ 由 N2 處理：**不送出**，Naki 合成錯誤回應交給遊戲與 Swift。

| 方法 | 檢查的 id | 證明不了時 | 本地成功後的狀態 |
|---|---|---|---|
| `changeCharacterSkin` | `character_id`、`skin` | 本地成功 | 記入 `sessionOverrides` |
| `changeMainCharacter` | `character_id` | 本地成功 | 同上 |
| `changeAvatar` | `avatar_id`（依皮膚清單） | 本地成功 | 同上 |
| `useTitle` | `title` | 本地成功 | 同上 |
| `setRandomCharacter` | `pool` 每一筆的 `character_id`、`skin_id`，全量 | 本地成功 | 記本地隨機池 |
| `updateCharacterSort` | `sort`、`other_sort`、`hidden_characters` 三個陣列全量 | 本地成功 | 記本地排序；之後同類請求只要本地排序存在就一律本地回應，避免伺服器拿到部分排序 |
| `setHiddenCharacter` | `chara_list` 全量 | 本地成功 | 同上 |
| `changeCharacterView`、`changeCommonView` | 角色、`item_id`／`value` | 本地成功 | 只在 F5 開啟時可達 |
| `saveCommonViews` | `views` 每一筆的 `item_id` 與 `item_id_list`，全量 | 本地成功，記本地預設組（索引→內容） | 本地預設組表 |
| `useCommonView` | `index` 是否指向本地預設組 | 指向本地預設組 ⇒ 本地成功；否則放行 | 避免伺服器套用它自己的舊組 |
| `setLoadingImage` | `images` 全量 | 本地成功 | 只在 F7 開啟時可達 |
| `sendGiftToCharacter`、`upgradeCharacter`、`addFinishedEnding`、`receiveEndingReward`、`receiveCharacterRewards`、`mmoActivitySetCharacter`、`mmoActivitySetTeamMember` | `character_id`（`members` 全量） | **本地錯誤**（不假裝成功：這些操作會扣道具或發獎勵，假成功會讓遊戲本地帳目錯亂） | 無 |

本地錯誤回應用的錯誤碼，遊戲是否能正常顯示：**需 live**（§7.5）。確認之前，F4 不開。

### 3.7 外送入口盤點

來源：`liqi.json` 中 Lobby 與 FastTest 所有請求，篩出請求欄位或方法名含外觀相關字樣的 86 個入口（外送盤點，含原始輸出）。逐一分類：

| 分類 | 入口 | 處置 |
|---|---|---|
| 換裝與角色操作 | §3.6 表中 19 個方法 | **攔截**（守衛方法） |
| 對局內 | `.lq.FastTest.broadcastInGame`（`content` 字串） | 攔不住（送出禁改、`respondLocally` 禁用）。**縮小功能使其不可達**：不做 F10；F1 在表情面板 live 確認前不開（v0.1b） |
| 對局內其他 | `inputOperation`、`inputChiPengGang`、`confirmNewRound`、`voteGameEnd` 等 FastTest 方法 | 確認無關：請求欄位沒有外觀 id（外送盤點只命中 `broadcastInGame`、`syncGame`、`finishSyncGame`、`startObserve`，後三者是名稱誤中） |
| 背包與商店 | `useBagItem`、`sellItem`、`composeShard`、`openManualItem`、`openRandomRewardItem`、`openAllRewardItem`、`openPreChestItem`、`buyFromShop`、`exchangeActivityItem`、`sendActivityGiftToFriend`、`modifyNickname`（`use_item_id`） | 確認無關的前提：**本插件不改背包與商店回應**。F5 若需要補背包才能顯示，F5 不開 |
| 文字與聊天 | `sayChatMessage`、`sendClientMessage`、`leaveComment`、`userComplain` | 推測無關（自由文字）。**需 live**：大廳聊天若有依角色產生的表情面板，F4 不開，直到確認面板只列擁有的 |
| 房間 | `createRoom`、`joinRoom`、`dressingStatus`（只有布林）、`startRoom`、`addRoomRobot`、`setFriendRoomRandomBotChar` | 確認無關：請求不帶外觀 id。其他玩家看到的外觀來自伺服器 |
| 活動與其他 | `islandActivity*`、`marathonActivityFinishRace`、`amuletActivityEffectSort`、`createCustomizedContest` 等 | 確認無關：命中的是道具位置、時間等欄位，不是外觀 id |
| 登入類 | `login`、`emailLogin`、`oauth2Login`（`random_key`） | 確認無關，且是送出禁改範圍 |

`liqi.json` 已知過期：盤點只涵蓋這份 schema 列出的方法。v1 的 live 驗收要以只觀察的插件記錄一整段大廳操作中所有送出的 method，與本表比對；出現表外方法時 F4–F9 停用，直到補進本表（§7.5）。

### 3.8 對局內改寫（`authGame`）

- 只改 `players` 中 `account_id` 等於自家身分的那一筆。`seat_list`、`game_config`、`robots`、`players` 的順序與筆數、每一筆的 `account_id`（field 1）與 `nickname`（field 4）不動。Swift 只讀這些（`LiqiParser.parsePlayerGameView` 只取 field 1、4；座位取 `seat_list`，缺時從 `players` 順序推，`MajsoulBridge` authGame 段）。
- **等長以實際值判定**：`uint32` 是 varint，不是固定寬度（例如 16383 是 2 bytes、16384 是 3 bytes）。每次都比對舊值與新值的編碼長度。
- **關聯欄位整組提交**（F1）：`character.charid`、`character.skin`、`avatar_id` 是一組。只有三者都能等長替換、且皮膚屬於該角色（依 v0.2 目錄判定）時才一起改；任一不成立就整組不改。
- 裝扮（F2）逐 slot 獨立：每個 slot 的 `item_id` 能等長替換就改，否則該 slot 不改。稱號（F3）獨立。
- 一律複製、改複本、`ctx.replace(複本)`，不直接寫 `ctx.bytes`。

### 3.9 設定持久化

- 唯一的持久化處是 Naki 的 `SettingsStore`（`plugin.<id>.<key>`）。不得用 `localStorage`、`indexedDB`、cookie。
- 設定頁經 `window.naki.set` 寫入，遊戲頁經 `ctx.settings` 唯讀讀取。
- 遊戲 UI 裡的本地選擇（`sessionOverrides`）只活在本世代，不持久化。長期保留的選擇在設定頁設定。
- 合併順序：`sessionOverrides` 優先於設定的覆寫，設定的覆寫優先於真實外觀。
- 設定變更：有 P9 時在 `onSettingsChanged` 換掉覆寫，其他狀態保留；沒有 P9 時插件被重跑，本世代視為 `unknown`（§3.5）。
- 畫面何時更新：推測大廳不會因設定改變而重抓資料。設定頁文案寫「已存，下一次載入大廳或進入對局時生效」。

---

## 4. 不變條件

| # | 條件 | 怎麼守 |
|---|---|---|
| I1 | **只改本機顯示**；伺服器收到的請求內容不因插件改變，只有「不送出」一種例外 | 不宣告 `rewriteSend`、`injectSend`；不呼叫 `sendRequest`、`sendRaw` |
| I2 | **伺服器永遠不會收到使用或擁有未擁有物品的請求** | §3.3 只在 `complete` 時補入；§3.6 判定 fail-closed；§3.5 撤銷由插件與 N1 共同守；§3.7 攔不住的入口以縮小功能處理。**v1 在 N1、N2 存在前不出** |
| I3 | 不改 `.lq.ActionPrototype`、`syncGame`、`NotifyGameEndResult` | 白名單不列；不宣告 `rewriteAllow` |
| I4 | `authGame` 只改自家那筆的外觀欄位 | §3.8 |
| I5 | 不碰 Naki 與插件自送流量 | `ctx.isNaki` 為 true 直接 return |
| I6 | 一律經 `ctx.replace` 改寫 | §3.8 末條 |
| I7 | 設定只存在 Naki 側 | §3.9 |
| I8 | **receive 側**解析不確定就不改（原樣通過） | 不確定時記一行 log，不記封包內容 |
| I9 | **send 側**證明不了擁有就不送出 | §3.6；與 I8 方向相反，是刻意的 |
| I10 | 使用者確認之前不做任何改寫 | `testAccountAck` 為 false 時不改寫；但已污染時守衛照常（§3.5） |

---

## 5. 設定頁

### 5.1 v0.1 的值

```json
"settings": {
  "enabled":        { "type": "boolean", "default": false, "description": "啟用本機外觀覆寫" },
  "testAccountAck": { "type": "boolean", "default": false, "description": "我確認只在測試帳號使用（未勾選時插件不做任何改寫）" },
  "titleId":        { "type": "number",  "default": 0,     "description": "對局內顯示的稱號 id（0＝不覆寫）" },
  "views":          { "type": "string",  "default": "",    "description": "對局內裝扮覆寫，格式 slot=itemId，以逗號分隔" }
}
```

v0.1b 加 `characterId`、`skinId`（`number`，預設 0）。數值不是 1 到 2^32−1 的整數就當作 0。

### 5.2 v0.1／v0.2 的 `settings.html`

1. 警語區（§6.4，固定文字）。
2. `testAccountAck` 勾選框；未勾選時下方控制項停用。`enabled` 開關。
3. 對局內外觀：稱號 id；裝扮表格（slot、item id、刪除），存檔時序列化成 `views`。v0.1b 起加角色與皮膚。
4. 目錄（v0.2 起）：「載入目錄」按鈕，按下才抓並解析 S6（約 17 MB）。數字輸入換成可搜尋選單，先選角色、再選該角色的皮膚。設定頁資料存放非持久，每次開頁要重按。失敗時顯示原因，數字輸入照常可用。slot 意義不寫死，以表裡的分類欄位顯示（欄位名需 live 確認）。
5. 狀態說明：「已存」只代表寫進 Naki；在下一場對局生效。

### 5.3 v1 的值（依賴 P7）

```json
"settings": {
  "testAccountAck": { "type": "boolean", "default": false },
  "views":          { "type": "string",  "default": "", "description": "舊版裝扮設定（v0.x），由設定頁遷移後清空" },
  "features":       { "type": "json",    "default": {} },
  "overrides":      { "type": "json",    "default": {} }
}
```

- `features`：`{ "inGame": bool, "characters": bool, "views": bool, "titles": bool, "loadingImages": bool, "voices": bool, "starred": bool }`，缺的 key 視為 false。`views`、`loadingImages`、`voices` 在對應前置確認前，設定頁顯示為停用。
- `overrides`（`<…>` 由使用者或目錄提供）：

```json
{
  "version": 1,
  "migratedFrom": "<上一版插件版本，或省略>",
  "mainCharacter": { "characterId": "<id>", "skinId": "<id>" },
  "characters": { "<characterId>": { "skinId": "<id>", "views": [{ "slot": "<n>", "itemId": "<id>" }] } },
  "titleId": "<id>",
  "loadingImages": ["<id>"],
  "commonViews": [{ "slot": "<n>", "itemId": "<id>" }],
  "starred": ["<characterId>"]
}
```

**遷移**：Naki 只下發 schema 目前宣告的 key（`PluginRegistry.grantDict`），所以 v1 **保留舊的 `views` 字串 key**，不改名、不改型別（改型別會讓舊字串被判為非法 JSON 而回 default，`plugin-v2.md` §12.4）。遷移由設定頁明確執行：開頁時若 `views` 非空且 `overrides.migratedFrom` 不存在，顯示「遷移舊設定」按鈕；按下後解析舊字串、寫入 `overrides`（含 `migratedFrom`），成功後才把 `views` 清成空字串。遊戲頁在遷移完成前沿用舊 `views`，遷移後只讀 `overrides`。舊 key 至少保留到下一個主版本。

---

## 6. 風險

### 6.1 封號

- 存在被偵測與封號的風險。MajsoulMax 的 README 自己也警告這件事（`plugin-system-design.md` §8.4 引原文）。本文件沒有偵測或封號的資料，**不比較**本插件與其他工具的風險高低。
- 只在測試帳號使用。

### 6.2 欄位漂移

- 本設計用到的欄位號全部來自已知過期的 `liqi.json`，沒有一個經過 live 封包驗證。receive 側逐欄驗 wire type，不符就不改（I8）；send 側不符就不送出（I9）。
- `lqc.lqbin` 可能已不是 Unity 客戶端的來源；目錄缺項時仍可手動輸入。
- 外送盤點只涵蓋 schema 列出的方法（§3.7 末段）。

### 6.3 Naki 主路徑

- Swift 看的是插件改過的 bytes（`plugin-system-design.md` §11 #4）。`authGame` 改壞會讓 Naki 推錯座位。對策：§3.8、I4、I6，以及 N7 等價測試。
- v1 的 `fetchInfo` 回應有 33 個欄位（證據檔），重編掉欄位會讓大廳壞掉。對策：只用 PV2-C 的 `modify`，`anomalies` 非空就不改。

### 6.4 警語文字（README 與設定頁逐字相同）

> 本插件只改你這台裝置上看到的畫面，其他玩家看到的仍是你帳號實際擁有的外觀。改寫遊戲封包可能違反雀魂的服務條款，有被封號的風險。**只在測試帳號使用，不要在主帳號啟用。** 停用本插件後，請重新載入遊戲頁面，畫面才會完全恢復。安裝插件等於信任插件作者：插件與遊戲在同一個環境執行，Naki 無法阻止插件做其他事。

---

## 7. 驗收計畫

沿用本 repo 的 `node:test` 加 `vm.runInNewContext` 寫法（`tests/name-hider.cjs`），新增 `tests/local-unlock.cjs`。封包 fixture 由測試檔內的最小編碼器組出，不提交任何真實封包。

### 7.1 v0.1（node）

fixture：`authGame` REQUEST（自家 `account_id`）、登入回應（同一 `account_id`）、`authGame` RESPONSE（四麻 4 位、三麻 3 位各一份；另一份缺 `seat_list`）。

| 案例 | 預期 |
|---|---|
| 稱號、裝扮 id 編碼長度相同 | `ctx.replace` 一次；只有自家那筆的目標 varint 變；總長度相同；`seat_list`、`game_config`、其他玩家、自家的 field 1 與 4 逐 byte 相同 |
| 新值跨過 varint 長度邊界（例如 16383 與 16384） | 該項不改 |
| `testAccountAck` 或 `enabled` 為 false | 不改 |
| 登入身分與 `authGame` REQUEST 身分不同、或缺任一 | 不改 |
| `ctx.isNaki` 為 true、`ctx.replace` 不存在、截斷、wire type 不符 | 不改、不拋錯 |
| `onDisable` 後 | 不改 |

變異測試：對自家判斷、長度比對、身分比對、ack 檢查各做一個變異，確認被抓到。

### 7.2 v0.1 的 Naki 端等價測試（N7）

Naki 端以 XCTest 把同一組 fixture 的「改寫前」與「插件改寫後」bytes 各餵一次 `LiqiParser`→`MajsoulBridge`，比對解析結果與產生的 MJAI 事件完全相同。涵蓋四麻、三麻、缺 `seat_list` 的推導路徑、重連後再次收到 `authGame`。插件改寫後的 bytes 由本 repo 的 node 測試輸出成 fixture 檔交給 Naki。這是 v0.1 的發布前置。

### 7.3 v0.1 live（只在測試帳號，由主線或用戶執行）

1. 確認是測試帳號。啟用插件，設定稱號與一個裝扮 slot，勾確認。
2. 開友人房加人機。
3. 確認自家稱號與裝扮依設定顯示；截圖。
4. 確認 Naki 座位正確、推薦正常、log 無插件錯誤。
5. **外送觀察**：同時啟用一個只觀察、白名單含 `.lq.FastTest.broadcastInGame` 的插件，整局記錄送出的 method。v0.1 不應讓任何新的外送出現。
6. **v0.1b 前置（不點擊）**：在設定了角色或皮膚覆寫的對局中，只打開表情面板截圖、**不點任何表情**，關閉後確認外送記錄沒有 `broadcastInGame`。面板只列真實擁有的表情 ⇒ F1 可開；列出覆寫角色的表情 ⇒ F1 不做。這一步要 v0.1b 的程式碼，在 v0.1b 開發分支上執行，不隨 v0.1 發布。
7. 有第二個測試帳號時，從對方畫面確認看到真實外觀；沒有就標「未驗證」。
8. 證據放 Naki 主 repo `.swfd/logs/unlock-v01-live/`。

### 7.4 v0.2

- node：測試時組出的小型 `ConfigTables` fixture，驗目錄解析與角色→皮膚從屬。
- live：(a) manifest 仍列出 `lqc.lqbin` 且版本與現行客戶端相符；(b) S1 實際收到的皮膚 id 都在目錄裡；(c) 設定頁實際抓得到。任一失敗就不出 v0.2，F1（v0.1b）也因缺從屬判定而不出。

### 7.5 v1（逐功能）

每個功能都要同時通過「接收改寫」「送出處置」「擁有來源」「live 條件」四欄；任一未通過，該功能維持關閉。

| 功能 | 接收改寫 | 送出處置 | 擁有來源 | live 通過條件 |
|---|---|---|---|---|
| F4 | §3.1 步驟 1、2、3、6 | §3.6 中 `useTitle` 與裝扮、CG 以外的各列 | §3.3 角色、皮膚 | 換一次未擁有皮膚：遊戲當成成功、畫面更新；外送證明（下）；換一次擁有皮膚：外送觀察看到真的送出、重新登入後真的換了 |
| F6 | `ResTitleList`、`TitleUpdate` | `useTitle` | §3.3 稱號 | 同上，換稱號 |
| F9 | `ResCharacterInfo.character_sort` 等 | `updateCharacterSort`、`setHiddenCharacter` | §3.3 角色 | 加一個未擁有角色到星標：本地成功、外送證明 |
| F5、F7、F8 | — | — | 未確認 | 先確認來源或控制欄位，再補本表 |

**外送證明**（任一本地回應的操作都要做）：本地回應的 msgId 不能只看「重新登入後外觀沒變」，因為被伺服器拒絕的請求也會有同樣結果。要同時看到：
1. Naki 對該 msgId 記錄「未送出」（N2 要求的結果紀錄）；
2. 之後 10 秒內沒有伺服器送來同 msgId 的回應（Swift 若同時收到合成與真實回應，第二筆會走 unmatched，Naki log 看得到）。

**其他 v1 live 項目**：
- 錯誤回應：對 §3.6 末列任一方法觸發一次本地錯誤，確認遊戲顯示失敗、不當機、不卡住；並記下用的錯誤碼。
- 撤銷：已污染後依 §3.5 表逐列操作，每次都嘗試換一次未擁有皮膚，確認外送證明成立。
- 外送盤點對照：只觀察的插件記錄一整段大廳操作的全部送出 method，與 §3.7 比對；有表外方法就停用 F4–F9。
- 大廳聊天表情面板：確認不列出未擁有角色的表情（§3.7）。

---

## 8. 交付切分與 Naki 端需求

### 8.1 版本

| 版本 | 內容 | 前置條件 |
|---|---|---|
| **v0.1** | F2、F3（對局內裝扮、稱號），等長改寫 | Naki ≥ 2.18.0；N7 等價測試在 Naki 端通過；§7.1 與 §7.3 第 1–5 步通過 |
| **v0.2** | 設定頁目錄選單 | §7.4 三項 live 全部成立 |
| **v0.1b** | F1（對局內角色、皮膚、頭像，整組提交） | v0.2 已出；§7.3 第 6 步證明表情面板只列真實擁有的表情 |
| **v1** | F4、F6、F9；F5、F7、F8 預設關閉 | N1、N2、N3、N4、N5、N6 全部完成；§7.5 對應列通過。建議 N8 |
| — | Phase 4 probe 紅，或 N1／N2 不被 Naki 接受 | 插件停在 v0.2／v0.1b；F4–F9 不做，也不改用 `rewriteSend` 替代 |

### 8.2 對 Naki 端的需求（最新）

**v1 硬性前置**

- **N1 送出守衛（持續到頁面重載）**：manifest 宣告 `sendGuard`（守衛方法清單，限 `.lq.Lobby.*` 且不在送出禁改名單）。插件第一次對大廳回應做變長改寫或呼叫 `respondLocally` 後，Naki 把該插件標為「已污染」。已污染時，即使插件被使用者停用、被自動停用、熱重載失敗、或 L3 總開關關掉，守衛方法的 REQUEST 都**不送出**，改由 Naki 合成錯誤回應交給遊戲與 Swift，直到頁面重載。守衛的錯誤回應不送出任何東西，不受 L3 開關限制。插件頁對已污染插件停用時提示重載並提供按鈕（對局中不重載）。
- **N2 送出側 fail-closed**：對 `sendGuard` 內的方法，hook 拋錯、`respondLocally` 被拒、回應建構失敗、插件不在鏈上時，**不撤回成原樣送出**，改為不送出並合成錯誤回應。現行 dispatch 對所有 hook 一律 fail-open（`naki-plugins.js` 的 snapshot 還原段），這條只對守衛方法改變語意。每一筆守衛方法的 msgId 記錄結果（已送出／本地成功／本地錯誤），供 §7.5 外送證明使用。錯誤碼由 Naki 與 live 結果共同決定。
- **N3 大廳連線 live probe**：Phase 4 probe 目前只涵蓋 game-gateway（`plugin-v2.md` §9.2）。大廳連線要有自己的 (a)(b)(c) 實測，**加上** `respondLocally` 的端到端實測：遊戲接受合成回應、Swift 正確配對、同一 msgId 只處理一次。不接受以「兩條連線註冊 handler 的方式相同」代替。
- **N4 PV2-B2**：變長 receive `replace` 涵蓋 `fetchInfo`、`fetchCharacterInfo`、`fetchTitleList`、`fetchAccountInfo`、登入回應（僅需等長，列出供確認）與 `NotifyAccountUpdate`；`respondLocally` 涵蓋 §3.6 的 19 個方法（都不在現行禁用名單內）。本插件不需要 `injectReceive` 與 receive `drop`。
- **N5 PV2-C**：`modify`／`decode` 涵蓋 `ResFetchInfo`、`ResCharacterInfo`、`ResAuthGame`、`AccountUpdate`、`ResTitleList`，以及 §3.6 守衛方法的請求型別（送出判定要解析它們）；`ResFetchInfo` 列進保真往返 fixture。需要 `envelope.response(msgId, payload)`，field 1 一定寫出空字串。
- **N6 `json` 設定型別**：沿用 `plugin-v2.md` §12.4 既定方案，無額外要求。

**v0.1 前置**

- **N7 等價測試**：§7.2 的 XCTest。只加測試，不改 Naki 行為。

**建議**

- **N8**：`onSettingsChanged`（PV2-B1 剩餘；沒有它，每次存設定本世代就回到 `unknown`）；`onSocketClose`（讓大廳斷線開新世代）；`ctx.outboundAllowed` 唯讀查詢（方便，但**不能**解決撤銷問題，撤銷靠 N1）。
- **N9**：receive 方向提供改寫鏈之前的原始 bytes（唯讀），讓插件從伺服器原始回應學擁有清單（§3.4）。沒有它，本插件以「偵測到衝突就停用該類解鎖」處理。

**撤回的需求**（第一版提過，審查後撤回）

- `ctx.setSetting`：遊戲 UI 的選擇目前不需要跨頁保存，等確實需要再提。
- 強制 `authGame` 只准改 `players`／`robots`：擋不住改 `players` 內的 `account_id`，不能當本插件的安全依據；本插件自己守 §3.8。

**文件漂移回報**：`plugin-api-v1.md` 頁首與 §3、§4、§5 仍寫 `rewriteSend` 未實作，與 2.18.0 不符。

### 8.3 未驗證項目

| 項目 | 驗證方式 |
|---|---|
| 對局內外觀取自 `authGame` 自家那筆 | v0.1 live |
| 實際 id 值的編碼長度（v0.1 範圍是否可交付） | v0.1 live |
| 全部欄位號 | live 封包 |
| 對局內表情面板是否依覆寫的角色產生 | §7.3 第 6 步（不點擊） |
| 大廳聊天是否有依角色產生的表情面板 | v1 live |
| 登入時送 `fetchInfo` 還是 `fetchCharacterInfo`；`unlock_list` 語意；頭像是否就是皮膚 id | live |
| 裝扮與加載 CG 的擁有來源；語音控制欄位 | live |
| `lqc.lqbin` 的四項 | §7.4 |
| 合成成功／錯誤回應被遊戲正確處理 | N3 與 §7.5 |
| 熱重載腳本執行期間不會插入 message 事件 | 推論自 `PluginRegistry.enableScript` 的單段腳本；需 Naki 端確認 |
| 舊版 Naki 遇到 `settingsUI` 欄位的行為 | 舊版 App 手測 |
| 特定操作是否外送 | **客戶端可驗**：外送觀察與 N2 結果紀錄（§7.3、§7.5） |
| 伺服器是否偵測或封號 | **客戶端無法驗證** |
