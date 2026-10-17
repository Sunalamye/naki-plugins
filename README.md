# naki-plugins

Naki 官方範例插件 repo。每個插件一個 `plugins/<id>/` 目錄（含 `plugin.json` + `plugin.js`）。
在 Naki 插件頁面貼 `Sunalamye/naki-plugins` 即可一次看到全部、批次引入。

## 插件

| 插件 | 說明 |
|---|---|
| `naki-plugin-ex-name-hider` | 暱稱隱藏 |
| `naki-plugin-ex-tile-highlighter` | 牌面變色 |
| `naki-plugin-ex-gist-logger` | 事件記錄 |
| `naki-plugin-ex-local-unlock` | 本機解鎖（1.0.0，需要 Naki 2.20.0 以上）：只改這台裝置上自家的外觀顯示（大廳主角色、皮膚、頭像、稱號；對局內稱號與裝扮），不送出任何請求，伺服器永遠不會收到使用未擁有物品的換裝請求。細節見 `plugins/naki-plugin-ex-local-unlock/README.md` |

## 自帶設定頁

`naki-plugin-ex-tile-highlighter`（1.3.0）與 `naki-plugin-ex-local-unlock`（1.0.0）在 manifest 宣告 `settingsUI`，插件頁會顯示它們自己的設定畫面。牌面變色的畫面有顏色色塊、淡化開關、即時預覽；本機解鎖的畫面要先勾選風險確認，才能操作其餘控制項。

- 需要 Naki 2.18.0 以上才看得到自帶設定頁。舊版 Naki 會忽略 `settingsUI`，改用 schema 自動渲染；停留在舊版 Naki 時，插件照常運作。
- 升級路徑：若在 Naki 2.17.0 時已把此插件更新到 1.3.0，升級到 Naki 2.18.0 後該插件可能顯示無效（缺設定頁檔）。到插件頁按「檢查更新」重新取回即可恢復。
- 設定頁只能經 `window.naki.get/set` 讀寫 `settings` 宣告過的 key，這個設定頁本身不連網、不載入外部資源（這是頁面的行為，不是 Naki 的保證）。

## 本機解鎖的警語

> 本插件只改你這台裝置上看到的畫面，其他玩家看到的仍是你帳號實際擁有的外觀。改寫遊戲封包可能違反雀魂的服務條款，有被封號的風險。**只在測試帳號使用，不要在主帳號啟用。** 停用本插件後，請重新載入遊戲頁面，畫面才會完全恢復。安裝插件等於信任插件作者：插件與遊戲在同一個環境執行，Naki 無法阻止插件做其他事。
