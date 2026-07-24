# 安装和使用 PhD Atlas

[English](INSTALLATION.md) | [简体中文](INSTALLATION.zh-CN.md)

一条命令，五分钟上线。PhD Atlas 是一套全栈博士申请管理系统，支持申请档案、材料、
导师联系、提醒、导出、备份等全流程管理。

## Docker 部署（推荐）

```bash
docker run --detach --name phd-atlas \
  --env DOMAIN="https://phd.example.com" \
  --volume phd-atlas-data:/app/storage \
  --restart unless-stopped \
  --publish 127.0.0.1:8000:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest
```

就这样。`DOMAIN` 换成你自己的 HTTPS 域名，其他全部自动处理：

- 🔐 **JWT 签名密钥** — 首次启动自动生成，持久化在 storage 卷中
- 🔑 **数据加密密钥** — 同上，用于加密数据库密码、AI 密钥等敏感信息
- 🌐 **BASE_URL / CORS / 主机名** — 从 DOMAIN 自动推导

服务监听 `127.0.0.1:8000`，前面放一个 Nginx/Caddy/Traefik 反代配置 HTTPS 即可。

### 使用 Docker Compose

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
# 编辑 .env，把 DOMAIN 改成你的域名（其他都可不填）
vim .env
docker compose up -d --wait
```

Compose 文件会自动创建命名卷持久化所有数据。

### 反代示例（Nginx）

```nginx
server {
    listen 443 ssl;
    server_name phd.example.com;

    ssl_certificate     /etc/letsencrypt/live/phd.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/phd.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        client_max_body_size 550m;
    }
}
```

## 首次进入 /admin

打开 `https://你的域名/admin`，五步初始化向导：

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
docker ps --filter name=phd-atlas

# 查看日志
docker logs -f phd-atlas

# 重启（不丢数据）
docker restart phd-atlas

# 更新到最新 beta 镜像
docker pull ghcr.io/zhoujasper/phd-atlas:latest
docker stop phd-atlas && docker rm phd-atlas
# 然后用同样的 docker run 命令重新启动
```

## 备份

1. **应用内备份：** 管理后台 → 系统信息 → 备份 → 创建完整工作空间备份
2. **卷备份（停止状态）：**
```bash
docker stop phd-atlas
docker run --rm -v phd-atlas-data:/data:ro -v $(pwd):/backup \
  alpine tar -czf /backup/phd-atlas-backup.tgz -C /data .
docker start phd-atlas
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
