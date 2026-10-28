# WeFood 私人食记

手机优先的私人饮食记忆库：记住吃过的店和菜、每个人的口味，下次出门时快速找到“我们都喜欢”的选择，并向朋友免登录分享推荐。

- 不连接美团或其他平台，所有内容由你手动记录、上传。
- 同一账号可多台手机同时登录；朋友可通过邀请注册独立账号。
- 分享是发布时的快照，可设 N 天 / N 个月 / 永久有效，随时撤销。

## 本地运行

需要 Node.js 24。

```bash
npm install
npm run dev        # API: http://127.0.0.1:4318，页面: http://127.0.0.1:4319
```

首次打开会要求初始化令牌，它只打印在启动服务的终端里（`首次初始化令牌：...`），防止别人抢先注册。也可以通过环境变量 `WEFOOD_SETUP_TOKEN` 指定（至少 16 位）。

生产方式：

```bash
npm run build
npm start          # 同源提供页面和 API，默认 http://127.0.0.1:4318
```

配置见 `.env.example`：

| 变量 | 说明 |
| --- | --- |
| `PORT` / `HOST` | 监听地址，默认 `4318` / `127.0.0.1` |
| `WEB_PORT` | 开发模式 Vite 端口，默认 `4319` |
| `DATA_DIR` | 数据目录，默认 `./data`（数据库与照片） |
| `TRUSTED_ORIGINS` | 允许写请求的来源，公网部署必须填实际域名，如 `https://food.example.com` |
| `SECURE_COOKIE` | HTTPS 部署时设为 `true` |
| `WEFOOD_SETUP_TOKEN` | 可选，固定首次初始化令牌 |

手机通过局域网 IP 访问时，需要把 `HOST` 设为 `0.0.0.0`，并把 `http://<IP>:<端口>` 加入 `TRUSTED_ORIGINS`。

## 店铺地址与真实地图

- “记录”中堂食需要店铺地址；可手填，或从真实地图搜索具体分店。已有店会复用地址，也能当场补位置；外卖不要求私人收货地址。
- “吃什么”支持列表/地图切换。地图与列表共用筛选条件，点击私人标记看食记，点击数量聚合放大；无坐标的店列为待标记。
- 记录页、记忆库新店和店铺编辑共用地图选址；选择 POI 回填名称、地址及 GCJ-02 坐标，手动点图可解析地址。旧档案和草稿不补造坐标、不删除。
- 沿用 WeTravel 的腾讯地图方案，但 WeFood 独立配置、不调用 WeTravel API、不读取旅行数据。

在本项目 `.env` 配置：`WEFOOD_TENCENT_JS_KEY`（底图，浏览器 Key，需设置域名限制）、`WEFOOD_TENCENT_KEY`（WebService Key，仅服务端）、可选 `WEFOOD_TENCENT_SK`（签名）。`WEFOOD_MAPS_DAILY_LIMIT=100`、`WEFOOD_MAPS_USER_DAILY_LIMIT=20` 是应用自设每日查询预算，并非腾讯免费额度；实际权限/额度以控制台为准。

没有 Key 时明确显示未配置，手填地址仍可使用。地图搜索发送关键词与区域；“我附近”仅在主动点击时请求定位，并通过腾讯转换 GPS 坐标，不持续追踪、不保存个人定位。私人点评、人物和照片不主动发送给地图服务。

当前真实地图/POI调用需要配置可用 Key 后实测；自动化测试使用模拟响应/SDK，不算真实供应商通过。查询、逆地址解析或底图失败均可回到手填地址。

## 检查

```bash
npm run typecheck
npm test           # API 测试（账号隔离、多设备、CSRF、幂等、冲突、照片、分享）
npm run test:e2e   # 用本机 Chrome 以手机视口跑完整流程，使用临时数据目录
```

## 备份

`DATA_DIR` 下的 `wefood.sqlite*` 与 `photos/` 是全部数据。备份前先停服务，或用 SQLite 在线备份：

```bash
sqlite3 data/wefood.sqlite ".backup 'wefood-backup.sqlite'"
```

“我的 → 导出数据”可以下载 JSON（不含照片文件）。

## 文档

- 需求与设计：`docs/requirements/WeFood产品与技术设计.md`
- 功能现状：`docs/功能规格/WeFood记忆库.md`
