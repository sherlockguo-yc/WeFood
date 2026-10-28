# WeFood 私人食记

手机优先的私人饮食记忆库：记住吃过的店和菜、每个人的口味，下次出门时快速找到“我们都喜欢”的选择，并向朋友免登录分享推荐。

- 不连接美团或其他平台，所有内容由你手动记录、上传。
- 同一账号可多台手机同时登录；朋友可通过邀请注册独立账号。
- 分享是发布时的快照，可设 N 天 / N 个月 / 永久有效，随时撤销。

## 公网访问

正式地址：**https://wefood.sherlockguo.com**。本机已有账号已迁移到 N150，可用原用户名和密码登录，不需要再次初始化。

部署走 GitHub Actions → Release（配置 R2 后优先分发）→ webhook → N150 自动部署，源码仓库为 https://github.com/sherlockguo-yc/WeFood。数据与密钥不进入公开仓库或 Release。N150 独立 Node 24，既有 Node 20 服务不变；数据在 `~/wefood/data`、配置在 `~/wefood/.env`、依赖在 `~/wefood-deps`。

腾讯地图已按授权在服务器复用 WeTravel 配置，真实地点搜索和新域名底图加载已通过验证。网址本身不提供 Key，本地开发仍需独立配置。

R2 快速分发尚缺新仓库上传凭据：现有备份凭据不具备 `deploy-artifacts` 桶权限。CI 明确提示缺失并使用 Release 兜底；可在 GitHub Actions Secrets 配置 `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_ACCOUNT_ID`、`R2_BUCKET` 及可选 `R2_ENDPOINT`。

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
- “吃什么”支持列表/地图切换，私人食记与列表共用筛选。地图可搜索店铺名（城市/区域或地图中心附近 1 公里），也可点击底图店名查看卡片，再加入记忆库或用这家店记录；同一腾讯地点已收录时复用，不重复添加。
- 橙色标记是自己的食记，蓝色是地图候选，不冒充口味推荐。空库也能搜索地图；多分店或结果未查完整时先选候选。无坐标的私人店列为待标记。
- 记录页、记忆库新店和店铺编辑共用地图选址；选择 POI 回填名称、地址及 GCJ-02 坐标，手动点图可解析地址。旧档案和草稿不补造坐标、不删除。
- 沿用 WeTravel 的腾讯地图方案，但 WeFood 独立配置、不调用 WeTravel API、不读取旅行数据。

在本项目 `.env` 配置：`WEFOOD_TENCENT_JS_KEY`（底图，浏览器 Key，需设置域名限制）、`WEFOOD_TENCENT_KEY`（WebService Key，仅服务端）、可选 `WEFOOD_TENCENT_SK`（签名）。`WEFOOD_MAPS_DAILY_LIMIT=100`、`WEFOOD_MAPS_USER_DAILY_LIMIT=20` 是应用自设每日查询预算，并非腾讯免费额度；实际权限/额度以控制台为准。

没有 Key 时明确显示未配置，手填地址仍可使用。地图搜索发送关键词与区域；“我附近”仅在主动点击时请求定位，并通过腾讯转换 GPS 坐标，不持续追踪、不保存个人定位。私人点评、人物和照片不主动发送给地图服务。

公网地图已完成真实 Key 下的底图及 POI 验证；本机开发仍需自行配置。自动化测试的模拟响应/SDK只验证行为契约，不能代替真实集成。查询、逆地址解析或底图失败均可回到手填地址。

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
