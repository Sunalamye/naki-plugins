# 本機解鎖插件設計：審查回應

**審查**：Astra，原文 Naki 主 repo `.swfd/logs/unlock-review/astra-review.md`（14 條：擋 3、應修 9、建議 2，總評 REWORK）。
**回應日期**：2026-10-14。**修訂後設計**：`docs/plan/unlock-plugin.md`（第二版）。決策流水：`docs/plan/unlock-plugin-implementation-notes.md` 決策 9 起。

## 統計

| 類別 | 條數 | 條目 |
|---|---|---|
| 採納 | 14 | 1–14 |
| 反駁（over-guard） | 0 | — |
| 反駁（over-build） | 0 | — |

第 1–9、11、12 條涉及帳號安全或資料正確性，依規則只能採納，或證明情境不可能發生。逐條檢查後都找不到「不可能發生」的證據，所以全部採納。第 10 條是設定資料遺失，也屬資料正確性。第 13、14 條是建議，採納理由見各條。

## 逐條

### 1【擋】停用與撤回確認沒有撤銷已解鎖狀態 — 採納

已確認現行 Naki 契約無法保證不漏送：插件被停用或自動停用後就不在派發鏈上（`naki-plugins.js` 的 `disable`、`noteFailure` 達 `FAILURE_LIMIT` 時 `registry.delete`）；L3 關掉時 `respondLocally` 會被拒（`plugin-v2.md` §4.5 第 7 點）。遊戲 UI 裡已補入的項目要到頁面重載才消失。

改動：
- 新增設計 §3.5「撤銷」：定義「已污染」狀態，逐一列出五種撤銷方式的處置與負責方。插件內的撤回（ack、enabled、功能開關）只停止新改寫，守衛持續到頁面重載。
- 插件做不到的部分寫成 v1 硬性前置 **N1 送出守衛**（§8.2）：已污染後，即使插件停用、自動停用、熱重載失敗、L3 關掉，守衛方法都不送出，改由 Naki 合成錯誤回應，直到頁面重載。
- I2 改寫為「v1 在 N1、N2 存在前不出」。原 §6.3 R5（承認漏送一次）刪除，因為 N1 已涵蓋這條路徑。
- 版本：v1 前置加 N1。N1 不被 Naki 接受時，插件停在 v0.2／v0.1b（§8.1 末列）。

### 2【擋】送出側的 fail-open 與 owned 未知時 fail-closed 衝突 — 採納

已確認現行 dispatch 對所有 hook 拋錯一律撤回改動、原樣送出（`naki-plugins.js` dispatch 的 snapshot 還原段）。所以未擁有的換裝請求遇到插件拋錯時會原樣送出。

改動：
- 不變條件拆成 I8（receive 側不確定就不改）與 I9（send 側證明不了擁有就不送出），明寫兩者方向相反是刻意的。
- 新增 §3.6「送出側判定」：解析失敗、wire type 不符都算「證明不了擁有」。
- 插件攔不住的情況（拋錯、`respondLocally` 被拒、回應建構失敗、插件不在鏈上）寫成 v1 硬性前置 **N2 送出側 fail-closed**：只對 `sendGuard` 方法改變語意，不送出並合成錯誤回應，每筆 msgId 記錄結果。

### 3【擋】九種攔截尚未涵蓋解鎖後可能觸發的全部外送路徑 — 採納

已對 `liqi.json` 的 Lobby 與 FastTest 全部請求做欄位盤點：86 個入口，原始輸出在 Naki 主 repo `.swfd/logs/unlock-design/outbound-inventory.txt`。

改動：
- 新增 §3.7「外送入口盤點」，逐一分類並標處置：攔截、縮小功能使其不可達、確認無關。
- 攔截清單從 9 個擴大為 19 個（§3.6），新增 `changeAvatar`、`setRandomCharacter`、`setHiddenCharacter`、`sendGiftToCharacter`、`upgradeCharacter`、`addFinishedEnding`、`receiveEndingReward`、`receiveCharacterRewards`、`mmoActivitySetCharacter`、`mmoActivitySetTeamMember`。會扣道具或發獎勵的操作回本地錯誤，不假裝成功。
- `.lq.FastTest.broadcastInGame` 攔不住（送出禁改範圍），而且不打算靠解除 `.lq.FastTest.*` 限制來補救。因此 **v0.1 範圍縮小**：對局內角色、皮膚、頭像（F1）移出 v0.1，成為 v0.1b。前置是 live 不點擊確認表情面板只列真實擁有的表情（§7.3 第 6 步），以及 v0.2 目錄。v0.1 只剩 F2（裝扮）與 F3（稱號），它們和對局內唯一帶自由內容的外送無關。
- 背包與商店類入口「確認無關」的前提是本插件不改背包；F5 若需要補背包就不開。
- 聊天類入口標「需 live」：大廳聊天若有依角色產生的表情面板，F4 不開。
- `liqi.json` 已知過期：v1 live 加一條「只觀察插件記錄全部送出 method，與 §3.7 比對；出現表外方法就停用 F4–F9」。

### 4【應修】owned 缺少完整性與失效規則 — 採納

改動：
- §3.3 改成逐類表格：完整快照、差量、刪除規則、目前狀態。每類分 `unknown` 與 `complete`；只有 `complete` 才補入未擁有項目。
- 完整快照一律整份取代，不與舊集合合併。稱號套用 `remove_titles`。
- 加載 CG 明寫 `Account.loading_image` 是已選用值、不是擁有清單；裝扮與 CG 的擁有來源未確認，固定 `unknown`，F5、F7 在 v1 預設關閉。
- §3.4 新增登入世代：登入回應、`NotifyAnotherLogin`、`NotifyAccountLogout`、頁面重載，以及有 `onSocketClose` 時的大廳斷線，都開新世代、清空擁有清單。

### 5【應修】鏈上的回應不等於伺服器原始回應 — 採納

改動：§3.4 新增規則。每次學習前讀 `window.__nakiPluginGrants`（只含已啟用插件，依 `setGrant`／`disable` 的實作），有其他插件對同一 method 持有改寫 capability 時，該類固定為 `unknown`，設定頁顯示衝突。新增建議 N9：Naki 提供改寫鏈之前的原始 bytes，屆時改用它並取消限制。依審查意見，不擴成惡意插件沙箱（U4）。

### 6【應修】`fetchAccountInfo` 改寫缺少自家帳號條件 — 採納

改動：§3.1 步驟 3。REQUEST 的 `account_id` 與回應的 `account.account_id` 都必須等於自家身分，才改寫、才學習。§3.4 規定以登入回應為身分來源，`authGame` REQUEST 必須一致；不一致或缺失時本世代全部回到 `unknown`，對局內改寫停止。

### 7【應修】九種 method 需要各自的判定與本地狀態轉移 — 採納

改動：§3.6 改成逐方法表格，每一列有檢查的 id、證明不了時的處置、本地成功後的狀態。重點：
- `saveCommonViews` 檢查 `views` 每筆的 `item_id` 與 `item_id_list`，並記本地預設組。
- `useCommonView` 指向本地預設組就本地回應，避免伺服器套用它自己的舊組。
- `updateCharacterSort`、`setHiddenCharacter`、`setRandomCharacter` 全量檢查陣列；本地排序存在後，同類請求一律本地回應。

### 8【應修】等長可行性必須落在實際值，且關聯外觀不能逐欄半套替換 — 採納

改動：
- §3.8 明寫 varint 長度依實際值判定，舉 16383／16384 為例。
- 角色、皮膚、頭像整組提交：三者都能等長、且皮膚屬於該角色（依 v0.2 目錄）時才一起改，否則整組不改。裝扮逐 slot 獨立、稱號獨立。
- §7.1 加跨長度邊界的案例。v0.1 能否交付列為 live 未驗證項（§8.3）。

### 9【應修】驗收沒有證明 MJAI 等價 — 採納

已確認 Swift 只從 `PlayerGameView` 取 field 1 與 4（`LiqiParser.parsePlayerGameView`），座位取 `seat_list`、缺時從 `players` 順序推。這只支持 I4 的方向，不是等價證明。

改動：新增 §7.2 與 **N7 等價測試**：Naki 端 XCTest 把改寫前後的 bytes 各餵一次 `LiqiParser`→`MajsoulBridge`，比對解析結果與 MJAI 事件，涵蓋四麻、三麻、缺 `seat_list`、重連後再收 `authGame`。N7 是 **v0.1 的發布前置**（原本 v0.1 沒有 Naki 端前置）。v1 的變長改寫另由 N4 的驗收與 §7.5 涵蓋。

### 10【應修】v1 的設定遷移按現有契約讀不到舊值 — 採納

已確認 Naki 只下發 schema 目前宣告的 key（`PluginRegistry.grantDict`）。

改動：§5.3 v1 schema 保留舊 `views` 字串 key，不改名、不改型別。遷移由設定頁以「遷移舊設定」按鈕明確執行，寫入 `overrides.migratedFrom` 後才清空 `views`。遊戲頁在遷移完成前沿用舊值。舊 key 至少保留到下一個主版本。

### 11【應修】v1 功能與驗收範圍不對稱 — 採納

改動：
- §7.5 改成逐功能表格，每列有接收改寫、送出處置、擁有來源、live 通過條件；任一欄未通過，該功能維持關閉。F5、F7、F8 因來源或控制欄位未確認，v1 預設關閉。
- 新增「外送證明」：不能只看重新登入後外觀沒變。要同時有 N2 記錄的「未送出」，以及 10 秒內沒有同 msgId 的伺服器回應（否則 Swift 會出現 unmatched）。
- §8.1 的 v1 前置明列「§7.5 對應列通過」。

### 12【應修】大廳 probe 不能以相同 handler 註冊方式替代 — 採納

改動：
- §8.2 N3 改為大廳連線**必須**有自己的 (a)(b)(c) 實測，加上 `respondLocally` 的端到端實測（遊戲接受、Swift 配對、同 msgId 只處理一次），明寫不接受以「註冊方式相同」代替。
- §3.2 改寫為「P3 與 P4 共享同一個前置 gate，但各有自己的端到端驗收」。

### 13【建議】將 Naki 新需求限縮到必要契約 — 採納

改動（§8.2）：
- `ctx.setSetting` 撤回，等遊戲 UI 的選擇確實需要跨頁保存再提。
- 「強制 `authGame` 只准改 `players`／`robots`」撤回，並寫明它擋不住改 `account_id`，不當安全依據。
- `ctx.outboundAllowed` 降為建議（N8），並寫明它不能解決撤銷問題，撤銷靠 N1。
- `json` 沿用既定方案（N6 無額外要求）。
- 需求分成「v1 硬性前置」「v0.1 前置」「建議」「撤回」四組。

### 14【建議】避免把風險警語寫成未經證明的風險比較 — 採納

改動：
- §6.1 刪除「風險同級」的比較，只寫存在封號風險、只用測試帳號。
- §6.4 警語刪除比較語句，加一句「停用後請重新載入頁面」。
- §8.3 把「特定操作是否外送」（客戶端可驗：外送觀察、N2 紀錄）與「伺服器是否偵測或封號」（客戶端無法驗證）分成兩列。

## 版本切分的變化

| 版本 | 第一版 | 第二版 |
|---|---|---|
| v0.1 | F1–F3，無 Naki 端前置 | F2、F3；前置加 N7 等價測試 |
| v0.1b | — | F1 整組提交；前置是 v0.2 目錄與表情面板 live 確認 |
| v0.2 | 目錄 | 不變 |
| v1 | F4–F9；前置 PV2-B2、PV2-C、json | F4、F6、F9 開，F5、F7、F8 預設關；前置加 N1、N2、大廳 probe 與 `respondLocally` 端到端（N3）、§7.5 逐功能 live |
