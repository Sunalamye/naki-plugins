# 本機解鎖 v1：審查回應

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
