# naki-plugins

Naki 官方範例插件 repo。每個插件一個 `plugins/<id>/` 目錄（含 `plugin.json` + `plugin.js`）。
在 Naki 插件頁面貼 `Sunalamye/naki-plugins` 即可一次看到全部、批次引入。

## 自帶設定頁

`naki-plugin-ex-tile-highlighter`（1.3.0）在 manifest 宣告 `settingsUI`，插件頁會顯示它自己的設定畫面（顏色色塊、淡化開關、即時預覽）。

- 需要 Naki 2.18.0 以上才看得到自帶設定頁。舊版 Naki 會忽略 `settingsUI`，改用 schema 自動渲染；停留在舊版 Naki 時，插件照常運作。
- 升級路徑：若在 Naki 2.17.0 時已把此插件更新到 1.3.0，升級到 Naki 2.18.0 後該插件可能顯示無效（缺設定頁檔）。到插件頁按「檢查更新」重新取回即可恢復。
- 設定頁只能經 `window.naki.get/set` 讀寫 `settings` 宣告過的 key，這個設定頁本身不連網、不載入外部資源（這是頁面的行為，不是 Naki 的保證）。
