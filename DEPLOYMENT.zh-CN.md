# 部署 PhD Atlas

[English](DEPLOYMENT.md) | [简体中文](DEPLOYMENT.zh-CN.md)

生产环境部署、反代、备份与升级指南。快速上手请先阅读
[INSTALLATION.zh-CN.md](INSTALLATION.zh-CN.md)。

## 生产环境要求

- Docker Engine 24+（推荐）或 64 位 Node.js 24 LTS
- 持久化本地磁盘用于 `storage/`（SQLite 文件不能放 NFS/SMB）
- HTTPS 反向代理（Nginx、Caddy、Traefik、IIS ARR）
- 至少 1 GB 内存

## Docker Compose

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
cp .env.example .env
```

编辑 `.env`，最小只需设置：

```dotenv
DOMAIN=https://phd.example.com
```

`BASE_URL`、`CORS_ORIGIN`、`ALLOWED_HOSTS` 会从 DOMAIN 自动推导。
`JWT_SECRET` 和 `SETTINGS_ENCRYPTION_KEY` 首次启动自动生成，
持久化在 `storage/bootstrap-secrets.json`。

```bash
docker compose pull
docker compose up -d --wait
docker compose ps
```

### 容器网络说明

- 容器内 `localhost` 指向容器本身
- 连接宿主机数据库使用 `host.docker.internal`
- 连接同一 Compose 项目中的数据库使用服务名
- 即使使用外部数据库，`/app/storage` 卷也不能删除

### 固定镜像版本

```dotenv
PHD_ATLAS_IMAGE=ghcr.io/zhoujasper/phd-atlas:0.1.0-beta.2
```

或使用不可变引用：

```dotenv
PHD_ATLAS_IMAGE=ghcr.io/zhoujasper/phd-atlas@sha256:<manifest-digest>
```

`latest` 和 `beta` 标签始终指向同一个最新的 Beta 版本。

## 反向代理

### Nginx

将 `deploy/nginx/phd-atlas.conf` 复制到 `/etc/nginx/sites-available/`，
替换域名和证书路径后启用。

关键配置：
- 转发原始 Host 和 `X-Forwarded-Proto` 头
- 转发 `Upgrade` 和 `Connection` 头（WebSocket）
- `proxy_read_timeout 3600s`（Admin 更新请求需要）
- `client_max_body_size 550m`

### Caddy

```caddy
phd.example.com {
    reverse_proxy 127.0.0.1:4317
}
```

### Traefik

```yaml
labels:
  - "traefik.http.routers.phd-atlas.rule=Host(`phd.example.com`)"
  - "traefik.http.services.phd-atlas.loadbalancer.server.port=4317"
```

### IIS ARR

将 `deploy/windows/web.config.example` 复制到 IIS 代理站点的 `web.config`，
绑定 HTTPS 证书，开启代理并保留 Host Header。

## 原生部署

### Ubuntu / Debian

```bash
# 安装 Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential python3 nginx

# 安装应用
sudo useradd --system --home /opt/phd-atlas --shell /usr/sbin/nologin phd-atlas
sudo git clone https://github.com/zhoujasper/phd-atlas.git /opt/phd-atlas
sudo chown -R phd-atlas:phd-atlas /opt/phd-atlas
sudo -u phd-atlas bash -lc 'cd /opt/phd-atlas && npm ci && npm run build && npm prune --omit=dev'

# 配置
sudo cp /opt/phd-atlas/.env.example /etc/phd-atlas/phd-atlas.env
sudo chmod 0600 /etc/phd-atlas/phd-atlas.env
# 编辑 /etc/phd-atlas/phd-atlas.env，设置 DOMAIN

# 安装 systemd 服务
sudo cp /opt/phd-atlas/deploy/linux/phd-atlas.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now phd-atlas
```

### RHEL / CentOS Stream

```bash
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs git gcc-c++ make python3 nginx
# 其余步骤同上，Nginx 配置放到 /etc/nginx/conf.d/
```

SELinux 强制模式下：

```bash
sudo setsebool -P httpd_can_network_connect 1
```

### Windows Server

需要 Node.js 24 LTS + WinSW + IIS（含 ARR、URL Rewrite、WebSocket Protocol）。

```powershell
git clone https://github.com/zhoujasper/phd-atlas.git C:\PhDAtlas
cd C:\PhDAtlas
Copy-Item .env.example .env
notepad .env    # 设置 DOMAIN
npm ci
npm run build
npm prune --omit=dev
```

将 WinSW 可执行文件保存为 `C:\PhDAtlas\PhDAtlas.exe`，复制
`deploy\windows\PhDAtlas.xml.example` 为 `PhDAtlas.xml`，
然后安装并启动服务。详见模板文件注释。

## 升级

### Docker

```bash
# 基础镜像升级
docker compose pull
docker compose up -d --wait

# 或 Admin 内更新（beta.2+）：管理后台 → 系统信息 → 系统更新 → 检查更新
```

### 原生

```bash
# 源码升级
sudo systemctl stop phd-atlas
cd /opt/phd-atlas
sudo -u phd-atlas git pull --ff-only
sudo -u phd-atlas npm ci
sudo -u phd-atlas npm run build
sudo -u phd-atlas npm prune --omit=dev
sudo systemctl start phd-atlas
```

Admin Release 包更新（beta.2+）：管理后台 → 系统信息 → 系统更新。
支持自动检查 GitHub Release 或手动上传 `.tar.gz`。

## 备份与回滚

### 双重备份策略

1. **应用内完整备份：** 管理后台 → 系统信息 → 备份（含 SQLite 热备与上传文件）
2. **基础设施快照：** 停止应用后复制完整 `storage/` 目录/卷，外加外部数据库快照

两层备份都要附带相同部署的加密密钥和镜像/版本标识。

### 回滚

停止应用，把以下内容作为同一组恢复：
- 上一版本的代码/镜像
- 与之匹配的完整 `storage/` 快照
- 外部数据库快照（如有）
- 匹配的 `SETTINGS_ENCRYPTION_KEY`

> 只回滚运行时代码不恢复数据，旧代码可能无法读取新版本 Beta 数据。

## 验收检查

- `/api/health` HTTPS 返回成功，WebSocket 以 101 完成升级
- 全新安装显示 `/admin` 的初始化步骤
- 数据库通过连接测试并在重启后保持数据
- 普通账户和管理员登录
- 创建、编辑、删除、上传、下载、导出均正常
- 可创建并验证完整工作空间备份的恢复
- PWA manifest 和 Service Worker 通过 HTTPS 加载
- SMTP 和 Web Push 分别通过测试
