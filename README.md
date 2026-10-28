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
