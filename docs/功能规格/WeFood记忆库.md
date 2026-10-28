# WeFood 记忆库功能规格

> 现状文档：描述当前实现如何工作。修改功能前先读本文，实现变化时同步更新。决策原因见 `docs/requirements/WeFood产品与技术设计.md`。

- 更新日期：2026-10-28
- 运行：Node.js 24、Express 5、better-sqlite3、React 19、Vite 8。

## 1. 页面

底部四个入口，单列手机布局（最大宽度 560px），固定底栏适配安全区。

| 路径 | 页面 | 功能 |
| --- | --- | --- |
| `/` | 吃什么 | 按方式、同行人物、口味/场景标签、人均预算筛选；结果附推荐理由、必点、注意、上次时间 |
| `/library` | 记忆库 | 店铺 / 菜品 / 记录三个分类，搜索与标签筛选，新建店铺 |
| `/restaurants/:id` | 店铺详情 | 值得点、需要避开、分人感受、菜品管理、就餐时间线、编辑/归档、补一条评价、再记一顿 |
| `/record` | 记一顿 | 选店或新建店、时间、堂食/外卖、同行人、实际吃的菜、分人分菜感受、花费、备注、照片 |
| `/me` | 我的 | 回顾统计、口味人物、标签管理/合并、设备会话、退出、改密码、邀请朋友、导出 |
| `/shares` | 分享管理 | 新建（预览后发布）、复制/打开、更新内容、续期、撤销 |
| `/s/:token` | 公开分享 | 免登录查看快照；到期/撤销显示状态说明 |
| `/join?invite=` | 邀请注册 | 未登录时显示注册表单 |

## 2. 数据与规则

- 业务表：`people`、`restaurants`、`dishes`、`meals`、`opinions`、`tags` 以 JSON 存储字段，带 `owner_id`、`version`；另有 `users`、`sessions`、`invites`、`attachments`、`idempotency_keys`、`shares`。
- 所有读写按登录账号的 `owner_id` 过滤；别人的 ID 一律返回 404。关联写入校验人物、店铺、菜品、照片都属于本人。
- 就餐保存在一个事务内写入就餐与其中的评价；点评的人必须在同行人中，评价的菜必须是本次选中的菜。
- 店铺、菜品、人物删除为归档，历史保留；就餐删除会同时删除其中的评价。
- 编辑带 `version`，旧版本保存返回 409；前端保留输入并提示，再次保存以用户内容为准。
- 创建请求可带 `Idempotency-Key`：相同键相同内容返回同一条记录；相同键不同内容返回 409。
- 金额以“分”保存，可为空；统计只计有金额的记录并显示缺失数量。
- 草稿存于本机 `localStorage`（按账号区分），保存成功后清除，不跨设备同步。

## 3. 选店规则（`GET /api/discover`）

1. 先应用硬条件：方式（有该方式的就餐记录）、标签（店铺标签或某道菜的标签命中）、预算（需填写人均且不超过）。不满足直接排除，不自动放宽。
2. 评价人：选了同行人时只看他们，否则看所有有评价的人。
3. 打分：喜欢 +2、不合口味 −3、想再吃 +2、不再点 −3，菜品评价权重 0.5；3 天内刚吃过 −2，超过 30 天没去且有好评时加分。
4. 已评价的店排在未评价前；未评价的店标“尚未评价”。
5. 必点：有人正面评价且无人负面评价的菜；注意：列出谁不喜欢哪道菜。

## 4. 认证与安全

- 首个账号需初始化令牌（终端打印或 `WEFOOD_SETUP_TOKEN`），之后仅能通过管理员邀请注册（7 天有效、一次性）。
- 密码 bcrypt（cost 12），至少 10 位；登录/注册每 IP 15 分钟 30 次限制。
- 会话：随机 token，数据库只存 SHA-256 摘要；HttpOnly、SameSite=Strict Cookie，30 天有效。每台设备独立会话，退出只影响当前设备；可在“我的”移除其他设备；改密码会注销全部设备。
- 写请求校验 `Origin` 在 `TRUSTED_ORIGINS` 内，并校验 `X-CSRF-Token`（未登录用握手 Cookie，登录后用会话令牌）。
- 照片：最多 8 张、每张 10MB，经 sharp 解码验证、纠正方向、去除元数据、转 WebP；仅本人可读（`Cache-Control: private, no-store`）。被记录或有效分享引用的照片不能删除；未引用超过 7 天的照片在服务启动时清理。
- 店铺链接只接受 http/https，仅用于跳转，服务端不访问。

## 5. 分享

- 选择店铺后自动带上被评为喜欢/想再吃的菜及对应评价，以及店铺和这些菜的照片；不包含备注、金额、就餐记录、不喜欢的评价。可选择是否显示评价人名字。
- 发布前可预览（`POST /api/shares/preview`）。
- 有效期：3 天、7 天、1 个月、3 个月、永久或自定义天/月；月按北京时间日历月计算，月末溢出取目标月最后一天。永久存为空。
- 更新内容按当前记录重建快照，不改变有效期；续期从当前时间重新计算；撤销不可恢复。
- 公开接口每次访问实时检查状态，到期/撤销返回 410，正文和照片都不可访问；响应 `no-store`、`noindex`、`no-referrer`。

## 6. API 一览

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `GET /api/auth/status` · `POST /api/auth/setup` · `/login` · `/register` | 状态、初始化、登录、邀请注册 |
| `GET /api/auth/me` · `POST /logout` · `GET /sessions` · `DELETE /sessions/:id` · `POST /password` · `POST /invites` | 账号与设备 |
| `GET/POST /api/{people,restaurants,dishes,meals,opinions,tags}` | 列表（`q`、`tag`、`restaurantId`、`archived=include`）与创建 |
| `GET/PUT/DELETE /api/{resource}/:id` | 详情、带版本修改、删除/归档 |
| `GET /api/restaurants/:id/overview` | 店铺详情聚合 |
| `POST /api/tags/merge` · `GET /api/tag-options` | 标签合并、标签选项 |
| `POST /api/photos` · `GET/DELETE /api/photos/:id` | 照片 |
| `GET /api/discover` · `GET /api/stats` · `GET /api/export` | 选店、统计、导出 |
| `GET/POST /api/shares` · `POST /shares/preview` · `PUT/DELETE /shares/:id` · `POST /shares/:id/renew` | 分享管理 |
| `GET /api/public/shares/:token` · `/photos/:id` | 公开快照与照片 |

## 7. 验证现状

- `npm test`：11 项 API 测试通过（多设备会话、账号隔离、CSRF/Origin、初始化与邀请、改密码、幂等、版本冲突、关联校验、照片权限与伪装文件、分享快照/撤销/照片、月末到期、选店与统计、导出）。
- `npm run test:e2e`：本机 Chrome、390/360px 手机视口完整流程通过；包含双设备、退出单设备、分享预览/公开/撤销、弱网响应丢失后重试不重复、无横向溢出、无控制台错误。
- 未验证：iPhone Safari 与安卓真机、PWA 安装、N150 部署、备份恢复演练。
