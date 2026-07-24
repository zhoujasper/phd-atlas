# 部署 PhD Atlas

[English](DEPLOYMENT.md) | [简体中文](DEPLOYMENT.zh-CN.md)

生产环境部署、反代、备份与升级指南。快速上手请先阅读
[INSTALLATION.zh-CN.md](INSTALLATION.zh-CN.md)。

## 生产环境要求

- Docker Engine 24+（推荐）或 64 位 Node.js 24 LTS
- 持久化本地磁盘用于 `storage/`（SQLite 文件不能放 NFS/SMB）
- HTTPS 反向代理（Nginx、Caddy、Traefik、IIS ARR）
- 至少 1 GB 内存

---

## 部署方案

三种平台完整部署脚本：Windows、Linux、宝塔面板。

### 方案一：Windows（CMD / PowerShell）

#### CMD 批处理脚本（`deploy-phd-atlas.bat`）

```batch
@echo off
chcp 65001 >nul
echo ========================================
echo   PhD Atlas - Windows Docker 部署
echo ========================================
echo.

echo [1/6] 停止并删除旧容器...
docker stop phd-atlas 2>nul
docker rm phd-atlas 2>nul
echo 完成.

echo [2/6] 删除旧数据卷（清理数据）...
docker volume rm phd-atlas-data 2>nul
echo 完成.

echo [3/6] 拉取最新镜像...
docker pull ghcr.io/zhoujasper/phd-atlas:latest
echo 完成.

echo [4/6] 创建并启动容器...
docker run --detach --name phd-atlas ^
  --env DOMAIN="http://localhost:8080" ^
  --env BASE_URL="http://localhost:8080" ^
  --env CORS_ORIGIN="http://localhost:8080" ^
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" ^
  --env NODE_ENV="development" ^
  --env SECURE="false" ^
  --env TRUST_PROXY="false" ^
  --volume phd-atlas-data:/app/storage ^
  --restart unless-stopped ^
  --publish 127.0.0.1:8080:4317 ^
  ghcr.io/zhoujasper/phd-atlas:latest
echo 完成.

echo [5/6] 等待容器启动...
timeout /t 5 /nobreak >nul

echo [6/6] 查看容器状态...
docker ps | findstr phd-atlas

echo.
echo ========================================
echo   ✅ 部署完成！
echo   🌐 访问地址：http://localhost:8080/admin
echo   ⚠️  首次访问需创建管理员账户
echo   ⛔ 请使用 localhost，不要用 127.0.0.1
echo ========================================
echo.
docker logs phd-atlas --tail 10
echo.
pause
```

#### PowerShell 脚本（`deploy-phd-atlas.ps1`）

```powershell
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PhD Atlas - Windows Docker 部署" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/6] 停止并删除旧容器..." -ForegroundColor Yellow
docker stop phd-atlas 2>$null
docker rm phd-atlas 2>$null
Write-Host "完成." -ForegroundColor Green

Write-Host "[2/6] 删除旧数据卷..." -ForegroundColor Yellow
docker volume rm phd-atlas-data 2>$null
Write-Host "完成." -ForegroundColor Green

Write-Host "[3/6] 拉取最新镜像..." -ForegroundColor Yellow
docker pull ghcr.io/zhoujasper/phd-atlas:latest
Write-Host "完成." -ForegroundColor Green

Write-Host "[4/6] 创建并启动容器..." -ForegroundColor Yellow
docker run --detach --name phd-atlas `
  --env DOMAIN="http://localhost:8080" `
  --env BASE_URL="http://localhost:8080" `
  --env CORS_ORIGIN="http://localhost:8080" `
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" `
  --env NODE_ENV="development" `
  --env SECURE="false" `
  --env TRUST_PROXY="false" `
  --volume phd-atlas-data:/app/storage `
  --restart unless-stopped `
  --publish 127.0.0.1:8080:4317 `
  ghcr.io/zhoujasper/phd-atlas:latest
Write-Host "完成." -ForegroundColor Green

Write-Host "[5/6] 等待容器启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "[6/6] 查看容器状态..." -ForegroundColor Yellow
docker ps | findstr phd-atlas

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ✅ 部署完成！" -ForegroundColor Green
Write-Host "  🌐 访问地址：http://localhost:8080/admin" -ForegroundColor Green
Write-Host "  ⚠️  首次访问需创建管理员账户" -ForegroundColor Yellow
Write-Host "  ⛔ 请使用 localhost，不要用 127.0.0.1" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
docker logs phd-atlas --tail 10
Read-Host "按 Enter 退出"
```

### 方案二：Linux / Ubuntu（Docker）

#### 部署脚本（`deploy-phd-atlas.sh`）

```bash
#!/bin/bash

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  PhD Atlas - Linux Docker 部署${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker 未安装！${NC}"
    echo "请先安装 Docker："
    echo "  curl -fsSL https://get.docker.com | sudo sh"
    echo "  sudo usermod -aG docker \$USER"
    exit 1
fi

echo -e "${YELLOW}[1/7] 停止并删除旧容器...${NC}"
sudo docker stop phd-atlas 2>/dev/null
sudo docker rm phd-atlas 2>/dev/null
echo -e "${GREEN}✅ 完成${NC}"

echo -e "${YELLOW}[2/7] 删除旧数据卷...${NC}"
sudo docker volume rm phd-atlas-data 2>/dev/null
echo -e "${GREEN}✅ 完成${NC}"

echo -e "${YELLOW}[3/7] 拉取最新镜像...${NC}"
sudo docker pull ghcr.io/zhoujasper/phd-atlas:latest
echo -e "${GREEN}✅ 完成${NC}"

echo -e "${YELLOW}[4/7] 创建并启动容器...${NC}"
sudo docker run --detach --name phd-atlas \
  --env DOMAIN="http://localhost:8080" \
  --env BASE_URL="http://localhost:8080" \
  --env CORS_ORIGIN="http://localhost:8080" \
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" \
  --env NODE_ENV="development" \
  --env SECURE="false" \
  --env TRUST_PROXY="false" \
  --volume phd-atlas-data:/app/storage \
  --restart unless-stopped \
  --publish 127.0.0.1:8080:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest
echo -e "${GREEN}✅ 完成${NC}"

echo -e "${YELLOW}[5/7] 等待容器启动...${NC}"
sleep 5

echo -e "${YELLOW}[6/7] 查看容器状态...${NC}"
sudo docker ps | grep phd-atlas

echo -e "${YELLOW}[7/7] 查看启动日志...${NC}"
sudo docker logs phd-atlas --tail 10

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}✅ 部署完成！${NC}"
echo -e "${GREEN}🌐 访问地址：http://localhost:8080/admin${NC}"
echo -e "${YELLOW}⚠️  首次访问需创建管理员账户${NC}"
echo -e "${RED}⛔ 请使用 localhost，不要用 127.0.0.1${NC}"
echo -e "${CYAN}========================================${NC}"
```

#### 使用方式

```bash
# 1. 赋予执行权限
chmod +x deploy-phd-atlas.sh

# 2. 运行
./deploy-phd-atlas.sh
```

#### 非 root 用户（Docker 已配置免 sudo）

```bash
#!/bin/bash
# 如果 Docker 已配置非 root 用户，去掉 sudo

docker run --detach --name phd-atlas \
  --env DOMAIN="http://localhost:8080" \
  --env BASE_URL="http://localhost:8080" \
  --env CORS_ORIGIN="http://localhost:8080" \
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" \
  --env NODE_ENV="development" \
  --env SECURE="false" \
  --env TRUST_PROXY="false" \
  --volume phd-atlas-data:/app/storage \
  --restart unless-stopped \
  --publish 127.0.0.1:8080:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest
```

### 方案三：宝塔面板部署（Docker 方式）

> 前提：宝塔面板已安装 **Docker 管理器** 或 **Docker** 应用。
> 确保服务器已开放 **8080** 端口（或自定义端口）。

#### 方法 A：宝塔 Docker 管理器（图形化）

**步骤 1：拉取镜像**

1. 登录宝塔面板
2. 进入 **Docker** → **镜像管理**
3. 点击 **获取镜像**
4. 输入：`ghcr.io/zhoujasper/phd-atlas:latest`
5. 点击 **拉取**

**步骤 2：创建容器**

1. 进入 **Docker** → **容器管理**
2. 点击 **创建容器**
3. 配置如下：

| 配置项 | 值 |
|--------|-----|
| 容器名称 | `phd-atlas` |
| 镜像 | `ghcr.io/zhoujasper/phd-atlas:latest` |
| 端口映射 | `127.0.0.1:8080:4317` |
| 重启策略 | `除非停止，否则始终重启` |

4. **环境变量**（点击添加）：

| 变量名 | 值 |
|--------|-----|
| `DOMAIN` | `http://你的域名或IP:8080` |
| `BASE_URL` | `http://你的域名或IP:8080` |
| `CORS_ORIGIN` | `http://你的域名或IP:8080` |
| `ALLOWED_HOSTS` | `localhost,你的域名或IP` |
| `NODE_ENV` | `development` |
| `SECURE` | `false` |
| `TRUST_PROXY` | `false` |

5. **数据卷**（点击添加）：
   - 容器目录：`/app/storage`
   - 服务器目录：`/www/wwwroot/phd-atlas-data`（或自定义）

6. 点击 **创建** 启动容器

**步骤 3：访问**

访问 `http://你的服务器IP:8080/admin` 完成初始化。

#### 方法 B：宝塔面板 SSH 终端

在宝塔面板的 **终端** 中执行：

```bash
# 1. 停止并删除旧容器（如有）
docker stop phd-atlas 2>/dev/null
docker rm phd-atlas 2>/dev/null

# 2. 创建数据目录
mkdir -p /www/wwwroot/phd-atlas-data

# 3. 启动容器
docker run --detach --name phd-atlas \
  --env DOMAIN="http://你的服务器IP:8080" \
  --env BASE_URL="http://你的服务器IP:8080" \
  --env CORS_ORIGIN="http://你的服务器IP:8080" \
  --env ALLOWED_HOSTS="localhost,127.0.0.1,你的服务器IP" \
  --env NODE_ENV="production" \
  --env SECURE="false" \
  --env TRUST_PROXY="false" \
  --volume /www/wwwroot/phd-atlas-data:/app/storage \
  --restart unless-stopped \
  --publish 127.0.0.1:8080:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest

# 4. 查看状态
docker ps | grep phd-atlas
docker logs phd-atlas --tail 20
```

#### 方法 C：Docker Compose（宝塔支持）

创建 `docker-compose.yml` 文件：

```yaml
version: '3.8'

services:
  phd-atlas:
    image: ghcr.io/zhoujasper/phd-atlas:latest
    container_name: phd-atlas
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:4317"
    environment:
      DOMAIN: "http://你的服务器IP:8080"
      BASE_URL: "http://你的服务器IP:8080"
      CORS_ORIGIN: "http://你的服务器IP:8080"
      ALLOWED_HOSTS: "localhost,127.0.0.1,你的服务器IP"
      NODE_ENV: "production"
      SECURE: "false"
      TRUST_PROXY: "false"
    volumes:
      - /www/wwwroot/phd-atlas-data:/app/storage
```

在宝塔 Docker 管理器中上传此文件并启动。

---

## Docker Compose（生产环境推荐）

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
# 或 NJU 镜像站
# PHD_ATLAS_IMAGE=ghcr.nju.edu.cn/zhoujasper/phd-atlas:0.1.0-beta.2
```

或使用不可变引用：

```dotenv
PHD_ATLAS_IMAGE=ghcr.io/zhoujasper/phd-atlas@sha256:<manifest-digest>
# 或 NJU 镜像站
# PHD_ATLAS_IMAGE=ghcr.nju.edu.cn/zhoujasper/phd-atlas@sha256:<manifest-digest>
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

## 管理命令

### Windows
```cmd
docker stop phd-atlas
docker start phd-atlas
docker restart phd-atlas
docker logs phd-atlas --tail 50
docker exec -it phd-atlas sh
```

### Linux / 宝塔
```bash
docker stop phd-atlas
docker start phd-atlas
docker restart phd-atlas
docker logs phd-atlas --tail 50
docker exec -it phd-atlas sh
```

## 注意事项

1. **统一使用 localhost 或域名访问**，避免 403 错误
2. **首次访问必须创建管理员账户**
3. 如果使用域名，将 `DOMAIN` 改为 `http://你的域名:8080`
4. 生产环境建议配置 HTTPS（使用 Nginx 反向代理）
5. 数据保存在 Docker 卷中，备份时需备份卷或挂载目录
6. `/admin` 初始化页支持亮色/暗色主题切换和语言切换（12 种语言）

## 验收检查

- `/api/health` HTTPS 返回成功，WebSocket 以 101 完成升级
- 全新安装显示 `/admin` 的初始化步骤，并带有主题和语言控制
- 数据库通过连接测试并在重启后保持数据
- 普通账户和管理员登录
- 创建、编辑、删除、上传、下载、导出均正常
- 可创建并验证完整工作空间备份的恢复
- PWA manifest 和 Service Worker 通过 HTTPS 加载
- SMTP 和 Web Push 分别通过测试
