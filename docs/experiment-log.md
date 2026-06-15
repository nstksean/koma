# 黑貓小說去廣告實驗記錄

**日期**：2026-05-22  
**目標**：解決黑貓小說 App 廣告問題，最終目標是仿寫無廣告閱讀器

---

## App 資訊

| 項目 | 內容 |
|------|------|
| App 名稱 | 黑貓小說 - 永遠陪伴你閱讀 |
| Bundle ID | com.catNovel.novelApp |
| 開發者 | YI CHU CHEN（台灣） |
| 官網 | https://miaoapp.net/ |
| 伺服器 | Cloudflare（美國），非中國 |
| App Store | https://apps.apple.com/tw/app/id1466194143 |

---

## 嘗試方案與結果

### ❌ 方案一：Cloudflare 1.1.1.1 擋廣告
- **結果**：無效
- **原因**：黑貓廣告是 SDK 內嵌（AdMob 等），不走一般 DNS 解析

### ❌ 方案二：mitmproxy 抓 API（Mac Proxy + iPhone）
- **設定步驟**：
  1. Mac 安裝 mitmproxy：`brew install mitmproxy`
  2. 啟動：`mitmweb --listen-port 8080 --web-port 8081`
  3. iPhone Wi-Fi → 手動 Proxy → `192.168.1.131:8080`
  4. Safari 開 `http://mitm.it` 下載安裝憑證
  5. 設定 → 一般 → 關於本機 → 憑證信任設定 → 開啟 mitmproxy
- **結果**：App 顯示 `catnovel network error 10`
- **原因**：App 內建 proxy 偵測或 SSL pinning，拒絕走 proxy 連線
- **iOS 限制**：繞過 SSL pinning 需要越獄，無法在未越獄 iPhone 上實現

### 🔄 方案三：仿寫無廣告閱讀器（進行中）
- **方向**：從公開中文小說網站抓取內容，自建本地閱讀器
- **候選來源**：
  - https://sto55.com/ （目前 Cloudflare 503，暫時無法存取）
  - https://www.qu.la/ （可存取，調查中）
  - 小說狂人等聚合站
- **計畫功能**：
  - 搜尋小說
  - 章節列表
  - 閱讀內容
  - 零廣告
  - 定期抓取追蹤書目

---

## 手機安全恢復步驟

完成實驗後執行：
1. 設定 → Wi-Fi → 點 ⓘ → 代理伺服器 → **關閉**
2. 設定 → 一般 → VPN 與裝置管理 → mitmproxy 描述檔 → **移除**
3. 設定 → 一般 → 關於本機 → 憑證信任設定 → mitmproxy → **關閉**

---

## 下一步

- [ ] 確認可用的小說來源網站
- [ ] 分析網站 HTML 結構（書籍頁、章節頁、內文頁）
- [ ] 建立 Python scraper
- [ ] 建立本地網頁閱讀器 UI
- [ ] 設定定期自動抓取
