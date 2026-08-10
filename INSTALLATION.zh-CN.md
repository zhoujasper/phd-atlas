# 安装和使用 PhD Atlas

[English](INSTALLATION.md) | [简体中文](INSTALLATION.zh-CN.md)

PhD Atlas 是一套全栈博士申请管理系统，支持申请档案、材料、导师联系、提醒、导出、
备份等全流程管理。生产环境统一使用仓库提供的完整 Docker Compose 契约。

## Docker Compose（生产环境推荐）

克隆仓库并创建受保护的环境文件：

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
cp .env.example .env
chmod 600 .env
# 编辑 .env，设置 DOMAIN=https://phd.example.com；随后把首次启动必需的
# 32–512 字节 operator token 直接写入受保护文件。
{ printf 'PHD_ATLAS_BOOTSTRAP_TOKEN='; openssl rand -base64 48 | tr -d '\n'; printf '\n'; } >> .env
docker compose pull
docker compose up -d --wait
```

不得打印、提交、发到聊天中或把 bootstrap token 写入 shell history。首次进入
`/admin` claim 页面时，只能通过可信本地编辑器从 `.env` 读取并输入；claim 被拒绝或
放弃后应旋转 token。使用 NJU 镜像时在 `.env` 设置 `PHD_ATLAS_IMAGE`，不得用精简的
`docker run` 取代 Compose 服务。

新生产工作空间必须设置 `DOMAIN` 和 `PHD_ATLAS_BOOTSTRAP_TOKEN`；其余基础项自动处理：

- 🔐 **JWT 签名密钥** — 首次启动自动生成，持久化在 storage 卷中
- 🔑 **数据加密密钥** — 同上，用于加密数据库密码、AI 密钥等敏感信息
- 🌐 **BASE_URL / CORS / 主机名** — 从 DOMAIN 自动推导

Compose 服务只监听宿主机 `127.0.0.1:4317`，前面放一跳 Nginx/Caddy/Traefik 反代并配置
HTTPS。`TRUST_PROXY=1` 仅因发布端口只绑定宿主机回环地址才是安全的；信任转发头时
绝不能把该端口直接暴露到公网。

Compose 文件会自动创建命名卷持久化所有数据。

### Nginx 反向代理

请使用项目提供的生产模板
[`deploy/nginx/phd-atlas.conf`](deploy/nginx/phd-atlas.conf)，替换其中的域名和证书
路径后启用站点。上方 Compose 部署保持 upstream 为 `127.0.0.1:4317`。

完整模板中的边界是有意设计的：普通 API 请求体保持 2 MiB，只有审计过的 9 个
multipart 端点获得精确的大请求上限，4 个流式端点保留各自的非缓冲规则。不要恢复
全站 500+ MiB 请求体上限，否则多人同时提交被拒绝的大请求也会额外消耗反代临时
存储与 I/O。

## 首次进入 /admin

打开 `https://你的域名/admin`，先输入受保护 `.env` 中必需的 bootstrap token。
浏览器 claim 被接受后进入五步初始化向导：

1. **管理员账户** — 创建首位管理员
2. **安全密钥** — 查看自动生成的密钥（可选重新生成）
3. **数据存储** — 默认 SQLite 零配置，也可选 MySQL/PostgreSQL/SQL Server
4. **系统邮件** — 配置 SMTP 发件邮箱
5. **确认创建** — 检查配置并完成初始化

首位管理员创建后，初始化入口永久关闭。

### 数据库选项

| 引擎 | 说明 |
| --- | --- |
| SQLite（默认） | 零配置，文件存于 `/app/storage/` |
| MySQL / MariaDB | 需提供专用数据库和账号 |
| PostgreSQL | 需提供专用 database/schema 和账号 |
| Microsoft SQL Server | 需提供专用 database/schema 和账号 |

> **注意：** 即使选择外部数据库，`/app/storage` 卷仍必须保留——它保存上传
> 文件、备份、加密的数据库连接信息和自动生成的安全密钥。

## 日常操作

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f phd-atlas

# 重启（不丢数据）
docker compose restart phd-atlas

# 更新到最新 beta 镜像
docker compose pull
docker compose up -d --wait
```

## 备份

1. **应用内备份：** 管理后台 → 系统信息 → 备份 → 创建完整工作空间备份
2. **卷备份（停止状态）：**
```bash
docker compose stop phd-atlas
docker compose run --rm --no-deps --entrypoint sh -v "$(pwd):/backup" phd-atlas \
  -c 'tar -czf /backup/phd-atlas-backup.tgz -C /app/storage .'
docker compose start phd-atlas
```

> ⚠️ 备份时必须同时保留 `storage/` 卷快照、外部数据库快照（如有）和
> `storage/bootstrap-secrets.json` 中的密钥。

## 原生部署

如需原生 Node.js 部署（systemd / WinSW），详见 [DEPLOYMENT.zh-CN.md](DEPLOYMENT.zh-CN.md)。

## 开发环境

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
npm ci
npm run dev
```

浏览器打开 `http://localhost:5173`，开发环境下 API 代理到 `localhost:4317`。

## 常见问题

- **端口被占用：** 修改 `--publish` 的第一个端口号，如 `-p 127.0.0.1:9000:4317`
- **容器不健康：** `docker logs phd-atlas` 查看日志
- **数据库连接失败（Docker 内连宿主机）：** 使用 `host.docker.internal`，不要用 `localhost`
- **反代后浏览器报离线：** 确认 WebSocket Upgrade 头已转发到 `/api/health/ws`
- **密钥丢失：** 从 `storage/bootstrap-secrets.json` 恢复，该文件由首次启动自动创建
- **更新后异常：** 参考 [DEPLOYMENT.zh-CN.md](DEPLOYMENT.zh-CN.md) 的回滚流程
