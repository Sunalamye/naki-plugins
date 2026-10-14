# ADR：本機解鎖插件設計定案（2026-10-14）

**狀態**：設計定案（第二版），v0.1 已實作（未 live 驗證，未發布）。
**設計**：`docs/plan/unlock-plugin.md`；審查回應：`docs/plan/unlock-plugin-review-response.md`；決策流水：`docs/plan/unlock-plugin-implementation-notes.md`。
**設計者**：Opus 5.5 high。**審查**：Astra（codex `gpt-6-astra`，唯讀 sandbox），原文在 Naki repo `.swfd/logs/unlock-review/astra-review.md`。**裁決**：主線。

## 背景
用戶要求以 MajsoulMax 的 mod 功能為對標，設計一個原創的 Naki 插件並放進本 repo，走「先設計、再做 Naki 前置、最後做插件」的完整路線。

## 決定
1. **只做本機顯示、伺服器看不到的功能**。不做表情、便捷提示、自訂名稱、主播／Pro 標識、地鐵模式。why：會被他人看到、影響對局判斷或可冒充身分。
2. **送出側用本地回應（respondLocally）處理換裝，不用 rewriteSend 改成 loginBeat**。why：大廳解鎖本來就需要變長改寫，兩者卡同一個 probe；rewriteSend 只會多送一筆伺服器看得到的異常請求。
3. **v0.1 只做對局內裝扮（F2）與稱號（F3）**；角色／皮膚／頭像（F1）移到 v0.1b。why：改角色可能改到表情面板，而 `broadcastInGame` 會外送給其他玩家，插件攔不住。
4. **id 一律執行期取得**：v0.1 手動輸入；v0.2 解析遊戲自己下載的 `lqc.lqbin`，任一前提不成立就退回手動輸入。不硬寫任何 id 清單。why：授權線（不得使用 MajsoulMax 的規則表或 id 對照）與資料新鮮度。
5. **v1 的硬性前置在 Naki 端**：N1 送出守衛（插件已污染後，守衛方法直到頁面重載都不送出，改由 Naki 合成錯誤回應，不受 L3 與停用影響）、N2 送出側 fail-closed（守衛方法遇到 hook 拋錯或本地回應失敗時不送出）、N3 大廳連線的 Phase 4 probe 加 respondLocally 端到端、N4 PV2-B2、N5 PV2-C、N6 json 設定型別。v0.1 只需 N7（Naki 端改寫前後解析等價的 XCTest，只加測試）。
   why：審查第 1、2 條證明現行契約在停用、自動停用、L3 關閉、hook 拋錯時會原樣送出換裝請求，等於讓伺服器收到「擁有未擁有物品」的宣稱；這只能由 Naki 端保證，不能靠插件或警語。
6. **N1、N2 不被 Naki 接受，或 probe 為紅：插件停在 v0.2／v0.1b，不改用 rewriteSend 替代。**

## 審查裁決
| 項目 | 數字 |
|---|---|
| Astra 條目 | 14（擋 3、應修 9、建議 2） |
| 採納 | 14 |
| 反駁 | 0 |
| 主線推翻的反駁 | 0（無反駁可裁） |

反駁率 0。第 1–12 條涉及帳號安全或資料正確性，依規則只能採納或證明情境不可能；設計者找不到不可能的證據。第 13、14 條為建議，採納後撤回 `ctx.setSetting` 與 authGame 強制限制、刪除未經證明的風險比較，範圍縮小。判定無過度採納。

## 主線決定（統帥代決）
- N1、N2 超出 Naki `plugin-v2.md` 的設計，並改變守衛方法的 fail-open 語意（設計 D5）。它們是安全邊界變更，Naki 端要另開設計工作包（Opus high 設計＋Astra 審查）；動到 `ws.send` 接線前依 Naki CLAUDE.md 先向用戶確認。
- 推進順序：Naki IRC 第二輪收尾 → N7 與 v0.1（可先交付）→ live probe（對局連線＋大廳連線，順帶抓 BR-06 重連快照）→ N1／N2 設計審查 → PV2-C、PV2-B2 → v1。

## 已知風險
- 封號風險：存在，無法從客戶端驗證伺服器是否偵測；只在測試帳號使用（README 與設定頁共用警語）。
- 欄位漂移：`liqi.json` 已知過期，全部欄位號需 live 確認。
- 未驗證項見設計 §8.3。
