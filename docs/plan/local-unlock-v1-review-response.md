# 本機解鎖 v1：審查回應

## 第一輪

審查原文：Naki repo `.swfd/logs/unlock-v1-review/astra-review1.md`（第一輪，對象 `d426f7f`）。裁決：主線，1【擋】6【應修】全採納。證據在 `naki-plugins/.swfd/logs/unlock-v1/r2-*`；測試名稱指 `tests/local-unlock.cjs`（單測）與 `tests/local-unlock-naki.cjs`（Naki 實際 runtime）。

## 五個未決問題

| 問題 | Astra 表態 | 處置 |
|---|---|---|
| 1. 大廳只有個人資料頁會變 | 接受為 v1 範圍 | 寫進插件 README「限制」，大廳左上角來源仍標推測 |
| 2. 補入角色 level 0、無 views | 候選實作，需 live | 列為 live 前置條件 1（設計 §10），不猜填初始值 |
| 3. 連擁有外觀也不能換 | 接受為 v1 代價 | 寫進插件 README「保證範圍」 |
| 4. 對局內改寫也自擋 | 依第 2 條處理 | 對局內改寫改為只在宿主已污染後才做（第 2 條） |
| 5. 主角色影響聊天／表情面板 | I2 前置條件 | 列為 live 前置條件 2：只開面板不點表情；列出未擁有表情且無可靠攔截時，角色功能不放行 |

## 逐條

| 條 | 類別 | 處置 | 證據 |
|---|---|---|---|
| 1 外送入口盤點不完整 | 擋，採納 | 以 `liqi.json` 盤點全部 RPC 請求（遞迴、含自由文字欄位），分 (a) 已守衛 19、(b) 未守衛 11 列、(c) 證明不帶入 6 類，寫進設計 §9。(b) 的宿主擴充清單寫進 notes「待宿主」；README 與設計明寫這些入口未守衛，live 只觀察不點擊 | `r2-inventory.cjs`、`r2-inventory.txt`；設計 §9 |
| 2 停用或自動移除後守衛消失 | 應修，採納 | 契約沒有插件主動污染 API，記入「待宿主」。對局內等長改寫改為只在宿主 `guardState().tainted` 已含本插件全部 19 個守衛方法時才做，因此任何改寫發生時宿主已接手守衛。README 改成實際成立的範圍 | 單測「in-game rewrites only after Naki has tainted…」；整合「auth-only…」「after a lobby rewrite… hot-disable…」「auto-removal after ten refusals…」 |
| 3 重複欄位、損壞 Character、field 0 | 應修，採納 | `walk` 拒絕 field 0；新增 `single`（至多一筆）；提交前驗證 `main_character_id`、每個 `Character` 的 `charid` 恰一筆與 `skin`、`Account` 的 `account_id` 恰一筆與 `title`、`avatar_id`、對局內 `title` 與 `ViewSlot` 欄位。任一不符整則不改 | 單測「duplicated single fields, damaged characters and field 0…」；變異 r2 前七條 |
| 4 登入與 authGame 漏 error | 應修，採納 | 登入回應帶 error 一律清身分；`authGame` 帶 error 不改 | 單測「error first…」；變異「r2 login error ignored」「r2 authGame error ignored」 |
| 5 authReq 未配對 | 應修，採納 | 以 `socketId:msgId` 為鍵保存請求的 `account_id`，回應取出即消耗；配不到不改；登入、登出、停用清空 | 單測「authGame identity pairs by (socketId, msgId)…」；整合「authGame responses pair with their own request…」；變異三條 |
| 6 kill-switch 可被熱重載重置 | 應修，採納 | `lobbyLocked` 與自擋旗標同掛 `window.__nakiLocalUnlock` | 單測「the page lock survives re-running…」；變異「r2 page state per run」 |
| 7 測試未涵蓋生命週期 | 應修，採納 | 整合測試從 4 個增為 9 個：只有對局內設定時停用、熱停用後 L3 開著與再啟用、自動移除、錯序配對、D10 交付故障（遊戲 listener 拋錯，`faults` 1、`reshapeLocked`，之後大廳停改、守衛仍擋） | `r2-plugin-tests.log` |

## 未處理（不屬本插件或需 live）

- 重載後遊戲是否從快取恢復改寫資料：列為 live 前置條件 4，目前沒有證據。
- (b) 類入口的實際守衛要等宿主擴充；`broadcastInGame` 在現行守衛設計下不可守衛。

## 第二輪

審查原文：Naki repo `.swfd/logs/unlock-v1-review/astra-review2.md`（對象 `d24d115`）。結果：0【擋】3【應修】1【建議】，主線裁決全採納。第一輪第 2、4、5、6 條判已修；第 1、3、7 條判部分。第 7 條剩頁面重載後的快取，只能 live。證據在 `naki-plugins/.swfd/logs/unlock-v1/r3-*`。

| 條 | 類別 | 處置 | 證據 |
|---|---|---|---|
| 1 對局內驗證隨設定分支 | 應修，採納 | 自家玩家的 `title` 單值與全部 `ViewSlot`（結構含巢狀 field 0、`slot`、`item_id` 單值）在規劃改寫前驗完，與 `cfg.titleId`、`views` 無關 | 單測「own-player validation does not depend on which field the settings change」，四個交叉案例：只改 views 時 title 重複；只改 title 時 `item_id` 重複、巢狀 field 0、`slot` 重複。在 `d24d115` 的插件上紅，本輪綠。變異「r3 …」三條被殺 |
| 2 盤點仍是關鍵字候選集 | 應修，採納 | 改為全部 443 個 RPC 請求的全部葉欄位，1342 列，逐列分 (a)(b)(c) 或待查。`gameMasterCommand.command`、`createRoom.pre_rule` 進 (b)，`openManualItem.select_id` 在待查。設計 §9 放摘要表，完整檔是附錄 | `r3-inventory.cjs`、`r3-inventory.tsv` |
| 3 (c) 把來源推論當證明 | 應修，採納 | (c) 只留空請求 79 個與 bool 欄位 100 個；其餘推論全部移到待查，寫明兩種查法（live 觀察、離線追值）。設計、README、notes 都寫明 I2 尚未驗收，README 的較窄保證不能替代 | 設計 §5、§9；插件 README「未守衛的入口，I2 尚未驗收」 |
| 4 歷史 Deviations 與目前裁決 | 建議，採納 | notes 第 7 項改為現行旗標 `window.__nakiLocalUnlock.touched`，並註明第一輪名稱已取代。「待宿主」改寫為依 live 證據裁定的候選清單，引用宿主 ADR 2026-10-17 後續裁決。另記 guard-taint-api 合併後改用，移除對 `guardState()` 的依賴，本輪不改 | notes「第三輪」段 |

### 審查的 live 觀察清單

已併入設計 §10 的 live 前置條件與 §9 待查查法。三個要點：先錄未改寫基準；大廳與對局連線都記錄，含未解析與非 RPC；只觀察、不點擊會提交的操作。Astra 指出「不點表情」排除不了自動送出路徑，這點維持在待查，不宣稱已排除。

## 復驗

復驗結論：可進受限 live。復驗者自選 12 個變異，V1、V3、V7、V10、V11 存活，見 `naki-plugins/.swfd/logs/unlock-v1/verify-own-mutation.log`。主線派第四輪小修，證據在 `r4-*`。

| 項目 | 處置 | 證據 |
|---|---|---|
| V1：鎖死後不拋錯 | 整合測試 D10 案例補「鎖死後開 L3，送守衛請求」，斷言不外送且原因是 `hook_threw` | `local-unlock-naki.cjs` D10 案例；`r4-verify-own-mutation.log` V1 被殺 |
| V3：已擁有角色沿用舊長度 | 單測：40 個角色，自家皮膚從 3 byte 縮成 1 byte，payload 超過 128，逐 byte 比對 | 單測「owned character whose skin shrinks…」；V3 被殺 |
| V7：`varintSize` 的 128 邊界 | 單測：等長稱號從 200 改成 128，兩者都是 2 byte | 單測「equal-length title across the 128 boundary…」；V7 被殺 |
| V10：varint 超過 32 位元照收 | 依第 3 項刻意改變：varint 收到 10 byte，tag 另加上限 | notes Deviation 22；單測「varints up to 10 bytes…」 |
| V11：登入不清待配對請求 | 補單測 | 單測「a new login drops pending authGame requests」；V11 被殺 |
| 精確化：結果相同不算改過 | 大廳與對局內都先比對 bytes，相同就不送 `replace`、不設 `touched`。README 改為「改寫且 bytes 確實有變」 | 單測「a rewrite that yields the original bytes…」，含只差最後一 byte 的反例；修前紅（`r4-red-before-fix.log`） |
| 可用性：int32 負值 | 允許 10 byte varint，11 byte 拒 | 單測「varints up to 10 bytes…」；修前紅 |
| 重載後持久快取 | notes 補記保證只到重載為止；README 限制段同步 | notes「保證只到頁面重載為止」 |

## 主線裁決（2026-10-17 第一輪 live 後）

- **合併進 master 而不是等觸發驗證**：測試 71/71、Astra 三輪 0 擋、live 無 I2 違規；README 已標「I2 未驗收、不發布」。留在分支只會讓證據與 worktree 一起散失，合併留證成本更低。
- **先二輪 live 找觸發點，再決定要不要改設計**：第一輪零改寫的原因是登入走 `fetchInfo.character_info` 與登入回應 `account`，而非插件壞掉。唯讀點開個人資料／宿舍頁就能確認 `fetchCharacterInfo` 由誰觸發，比直接改走 `fetchInfo`（變長改寫新路徑、要重審）便宜一個量級；若仍不觸發再開 v1.1。
- **候選改法已查**：`fetchInfo` 不在宿主變長禁改名單；`oauth2Login` 回應在名單內只能等長改寫，零稱號帳號的 title 一個 byte 改不了，頭像 id 等長或可。
- **plist 殘留四鍵由主線清**：用檔案路徑形式 `defaults delete`，不用 `defaults write`。

## 主線裁決（2026-10-17 第二輪 live 後）：開 v1.1

- 事實：`fetchCharacterInfo` 在 4 次登入、10 次重連與所有可開頁面都沒出現；`fetchAccountInfo` 只在對局後 bot_sync 重連出現一次。v1 在一般登入幾乎不作用。
- 裁決：改走 `fetchInfo.character_info`（變長改寫，宿主允許）＋登入回應 `account.avatar_id`（等長改寫；`oauth2Login` 在變長禁改名單）。零稱號帳號的 title 一 byte 不改，維持「不符則整則不改」。
- 取捨：保留 v1 只改兩個方法等於保留一個幾乎不觸發的插件；改走 `fetchInfo` 讓宿舍、皮膚清單與大廳一致（第二輪見大廳與宿舍矛盾），代價是觸碰登入流程的回應，需 Astra 重審與再一輪 live。
- 守衛名單擴充仍不動：兩輪 live 守衛名單外零命中，無證據支持擴充。
