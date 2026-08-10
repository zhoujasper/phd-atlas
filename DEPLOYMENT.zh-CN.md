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

所有平台（包括宝塔）的生产部署统一使用仓库的 `compose.yaml` 与下文 HTTPS
反向代理。方案一至三中的原始 `docker run` 仅用于**本机临时 HTTP 体验**，
不是升级或生产流程，不得暴露给其他机器，并且有意不配置自动重启策略。

### 方案一：Windows 本机体验（CMD / PowerShell）

#### CMD 批处理脚本（`deploy-phd-atlas.bat`）

```batch
@echo off
chcp 65001 >nul
echo ========================================
echo   PhD Atlas - Windows 本机体验
echo ========================================
echo.

echo [1/5] 停止并删除旧体验容器...
docker stop phd-atlas 2>nul
docker rm phd-atlas 2>nul
echo 完成.

echo [2/5] 拉取最新镜像...
docker pull ghcr.io/zhoujasper/phd-atlas:latest
echo 完成.

echo [3/5] 创建并启动仅本机可访问的体验容器...
docker run --detach --name phd-atlas --init --stop-timeout 75 ^
  --memory 1g --memory-reservation 512m --cpus 2 --pids-limit 256 ^
  --security-opt no-new-privileges --cap-drop ALL ^
  --log-opt max-size=10m --log-opt max-file=5 ^
  --env DOMAIN="http://localhost:8080" ^
  --env BASE_URL="http://localhost:8080" ^
  --env CORS_ORIGIN="http://localhost:8080" ^
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" ^
  --env NODE_ENV="development" ^
  --env SECURE="false" ^
  --env TRUST_PROXY="false" ^
  --volume phd-atlas-data:/app/storage ^
  --publish 127.0.0.1:8080:4317 ^
  ghcr.io/zhoujasper/phd-atlas:latest
echo 完成.

echo [4/5] 等待容器启动...
timeout /t 5 /nobreak >nul

echo [5/5] 查看容器状态...
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
Write-Host "  PhD Atlas - Windows 本机体验" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/5] 停止并删除旧体验容器..." -ForegroundColor Yellow
docker stop phd-atlas 2>$null
docker rm phd-atlas 2>$null
Write-Host "完成." -ForegroundColor Green

Write-Host "[2/5] 拉取最新镜像..." -ForegroundColor Yellow
docker pull ghcr.io/zhoujasper/phd-atlas:latest
Write-Host "完成." -ForegroundColor Green

Write-Host "[3/5] 创建并启动仅本机可访问的体验容器..." -ForegroundColor Yellow
docker run --detach --name phd-atlas --init --stop-timeout 75 `
  --memory 1g --memory-reservation 512m --cpus 2 --pids-limit 256 `
  --security-opt no-new-privileges --cap-drop ALL `
  --log-opt max-size=10m --log-opt max-file=5 `
  --env DOMAIN="http://localhost:8080" `
  --env BASE_URL="http://localhost:8080" `
  --env CORS_ORIGIN="http://localhost:8080" `
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" `
  --env NODE_ENV="development" `
  --env SECURE="false" `
  --env TRUST_PROXY="false" `
  --volume phd-atlas-data:/app/storage `
  --publish 127.0.0.1:8080:4317 `
  ghcr.io/zhoujasper/phd-atlas:latest
Write-Host "完成." -ForegroundColor Green

Write-Host "[4/5] 等待容器启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "[5/5] 查看容器状态..." -ForegroundColor Yellow
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

### 方案二：Linux / Ubuntu 本机体验（Docker）

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
echo -e "${CYAN}  PhD Atlas - Linux 本机体验${NC}"
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

echo -e "${YELLOW}[1/6] 停止并删除旧体验容器...${NC}"
sudo docker stop phd-atlas 2>/dev/null
sudo docker rm phd-atlas 2>/dev/null
echo -e "${GREEN}✅ 完成${NC}"

echo -e "${YELLOW}[2/6] 拉取最新镜像...${NC}"
sudo docker pull ghcr.io/zhoujasper/phd-atlas:latest
echo -e "${GREEN}✅ 完成${NC}"

echo -e "${YELLOW}[3/6] 创建仅本机可访问的体验容器...${NC}"
sudo docker run --detach --name phd-atlas --init --stop-timeout 75 \
  --memory 1g --memory-reservation 512m --cpus 2 --pids-limit 256 \
  --security-opt no-new-privileges --cap-drop ALL \
  --log-opt max-size=10m --log-opt max-file=5 \
  --env DOMAIN="http://localhost:8080" \
  --env BASE_URL="http://localhost:8080" \
  --env CORS_ORIGIN="http://localhost:8080" \
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" \
  --env NODE_ENV="development" \
  --env SECURE="false" \
  --env TRUST_PROXY="false" \
  --volume phd-atlas-data:/app/storage \
  --publish 127.0.0.1:8080:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest
echo -e "${GREEN}✅ 完成${NC}"

echo -e "${YELLOW}[4/6] 等待容器启动...${NC}"
sleep 5

echo -e "${YELLOW}[5/6] 查看容器状态...${NC}"
sudo docker ps | grep phd-atlas

echo -e "${YELLOW}[6/6] 查看启动日志...${NC}"
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

docker run --detach --name phd-atlas --init --stop-timeout 75 \
  --memory 1g --memory-reservation 512m --cpus 2 --pids-limit 256 \
  --security-opt no-new-privileges --cap-drop ALL \
  --log-opt max-size=10m --log-opt max-file=5 \
  --env DOMAIN="http://localhost:8080" \
  --env BASE_URL="http://localhost:8080" \
  --env CORS_ORIGIN="http://localhost:8080" \
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" \
  --env NODE_ENV="development" \
  --env SECURE="false" \
  --env TRUST_PROXY="false" \
  --volume phd-atlas-data:/app/storage \
  --publish 127.0.0.1:8080:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest
```

### 方案三：宝塔本机体验或生产 Compose

> 前提：宝塔面板已安装 **Docker 管理器** 或 **Docker** 应用。
> 方法 A、B 仅供隔离体验：8080 必须绑定回环地址；远程管理请使用 SSH 隧道，
> 不得在服务器防火墙中开放该端口。

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
| 重启策略 | `不自动重启` |
| 内存 / CPU / PID | `1 GiB / 2 CPU / 256` |
| 安全 | `no-new-privileges`、删除全部 capabilities |

4. **环境变量**（点击添加）：

| 变量名 | 值 |
|--------|-----|
| `DOMAIN` | `http://localhost:8080` |
| `BASE_URL` | `http://localhost:8080` |
| `CORS_ORIGIN` | `http://localhost:8080` |
| `ALLOWED_HOSTS` | `localhost,localhost:8080,127.0.0.1` |
| `NODE_ENV` | `development` |
| `SECURE` | `false` |
| `TRUST_PROXY` | `false` |

5. **数据卷**（点击添加）：
   - 容器目录：`/app/storage`
   - 服务器目录：`/www/wwwroot/phd-atlas-data`（或自定义）

6. 点击 **创建** 启动容器

**步骤 3：访问**

在服务器本机访问 `http://localhost:8080/admin`；管理工作站必须先建立 SSH
隧道，绝不能直接暴露此 HTTP 体验环境。

#### 方法 B：宝塔面板 SSH 终端

在宝塔面板的 **终端** 中执行：

```bash
# 1. 停止并删除旧容器（如有）
docker stop phd-atlas 2>/dev/null
docker rm phd-atlas 2>/dev/null

# 2. 创建数据目录
mkdir -p /www/wwwroot/phd-atlas-data
chown 1000:1000 /www/wwwroot/phd-atlas-data

# 3. 启动容器
docker run --detach --name phd-atlas --init --stop-timeout 75 \
  --memory 1g --memory-reservation 512m --cpus 2 --pids-limit 256 \
  --security-opt no-new-privileges --cap-drop ALL \
  --log-opt max-size=10m --log-opt max-file=5 \
  --env DOMAIN="http://localhost:8080" \
  --env BASE_URL="http://localhost:8080" \
  --env CORS_ORIGIN="http://localhost:8080" \
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" \
  --env NODE_ENV="development" \
  --env SECURE="false" \
  --env TRUST_PROXY="false" \
  --volume /www/wwwroot/phd-atlas-data:/app/storage \
  --publish 127.0.0.1:8080:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest

# 4. 查看状态
docker ps | grep phd-atlas
docker logs phd-atlas --tail 20
```

#### 方法 C：Docker Compose（宝塔支持）

生产环境必须上传仓库中未经删减的 `compose.yaml` 与审核过的 `.env`，随后配置
下文 HTTPS 反向代理。不要在面板里重建一个精简服务；提供的 Compose 文件统一管理
停止窗口、内存/CPU/PID/日志限制、持久卷、代理信任和重启熔断契约。

---

## Docker Compose（生产环境推荐）

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
cp .env.example .env
```

编辑 `.env`，首次启动前必须同时设置下面两项。bootstrap token 必须是密码管理器
或 `openssl rand -base64 48` 生成的私密 32–512 字节值，不能照抄占位符：

```dotenv
DOMAIN=https://phd.example.com
PHD_ATLAS_BOOTSTRAP_TOKEN=<私密随机运维令牌>
```

`BASE_URL`、`CORS_ORIGIN`、`ALLOWED_HOSTS` 会从 DOMAIN 自动推导。
`JWT_SECRET` 和 `SETTINGS_ENCRYPTION_KEY` 首次启动自动生成，
持久化在 `storage/bootstrap-secrets.json`。

仓库提供的 `compose.yaml` 会固定
`PHD_ATLAS_PROJECT_ROOT=/app` 与 `PHD_ATLAS_STORAGE_ROOT=/app/storage`，并与
`phd-atlas-data` 挂载点保持一致；`.env` 无法把容器耐久数据重定向到其他位置，
entrypoint 启动时也会拒绝不匹配的 storage root。因此数据库、自动生成密钥、上传、
备份及持久重启熔断状态会在容器重建后仍作为同一组保留。

提供的 Compose 服务会强制使用 `NODE_ENV=production`。由于 API 发布端口固定绑定
宿主机 `127.0.0.1`，它同时默认使用 `TRUST_PROXY=1`，只信任一跳宿主机反代。
只有私有反代链路不同时才应在 `.env` 中覆盖 `TRUST_PROXY`，且必须填写精确跳数或
可信子网。信任转发头时绝不能把 4317 端口发布到公网。镜像级
`TRUST_PROXY=loopback` 只是更窄的后备默认值，用于让容器内部生产就绪探针可信地
标记 HTTPS；Compose 会为宿主机反代明确覆盖为一跳。

PhD Atlas 应始终只运行一个应用副本。不要对同一工作空间使用
`docker compose up --scale`、Docker Swarm replicas、PM2 cluster 模式或多个
systemd unit。SQLite 能协调自身 SQL 文件，但实时订阅、准入队列、后台任务归属、
更新状态及部分上传协调有意保持为进程内所有者。受支持的 100 用户容量来自单 worker
内部的有界并发，而不是让多个 worker 共享同一个 storage 卷。

请保留分层停止窗口：worker 最多用 20 秒排空请求与后台任务，然后进入 40 秒的有引用
指数退避主恢复窗口；若 source of truth 仍不可用，会继续以最长 5 秒间隔低频重试，
绝不会在耐久性未确认时主动退出。容器内层 supervisor 等待 70 秒，
Compose/systemd 至少等待 75 秒才会发送 SIGKILL。独立更新 helper 在 65 秒停止等待，
严格早于两层强杀边界；它只有在旧 PID 已消失，且独立原子 safe-exit marker 与更新
ID、随机 handoff nonce、更新包、目标版本、旧 PID 和退出码 75 全部精确匹配时才会
安装更新。OOM、人工强杀、旧 marker 或错误 helper 都会让更新中止。强制终止是最后
的数据风险边界，不应缩短这些外层窗口。

容器 supervisor 还在已挂载的 `/app/storage` 卷中维护持久化重启熔断器。worker 或
运行时准备连续快速失败 8 次后会写入
`diagnostics/container-restart-fuse.json`。Compose 最多再重建一次容器；新容器读取
同一 marker，并在剩余的 15 分钟冷却期内不启动 worker。普通单次退出仍由
`restart: unless-stopped` 自动恢复，但配置错误或 OOM 不会跨容器 ID 无限热循环。
应在冷却期检查有界诊断并修复根因；marker 到期后自动删除。绝不能卸载
`/app/storage` 绕过熔断。

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

`latest` 和 `stable` 指向通过验证的最高稳定版；`beta` 只指向通过验证的最高 Beta，
不会把稳定版安装重新带回预发布通道。

## 反向代理

### Nginx

将 `deploy/nginx/phd-atlas.conf` 复制到 `/etc/nginx/sites-available/`，
替换域名和证书路径后启用。

关键配置：
- 转发原始 Host 和 `X-Forwarded-Proto` 头
- 让 `TRUST_PROXY` 与私有反代路径一致（提供的宿主机回环 Compose 拓扑使用 `1`；
  同机 systemd 服务使用 `loopback`）
- 转发 `Upgrade` 和 `Connection` 头（WebSocket）
- `proxy_read_timeout 3600s`（Admin 更新请求需要）
- 服务级 `client_max_body_size` 保持为 `2m`。示例模板只放宽完整审计过的 multipart
  路由族：普通文件批量上传为 `502m`（20 x 25 MiB 加有界 multipart 开销），外发
  邮件为 `52m`（应用会强制执行 50 MiB 附件总预算），系统更新包为 `102m`（单个
  100 MiB 更新包）。
- 启用站点前创建 `/var/lib/nginx/phd-atlas-client-body`，授予 Nginx worker 写权限，
  并在独立文件系统上至少保留 6 GiB 可用空间。仅上传路由使用的 zone 会把活动缓冲
  上传限制为全局 8 个、每客户端 IP 4 个，并限制上传开始速率。校园/公司同一 NAT
  可使用一半有界代理容量，同时不会饿死其他网络；Nginx 自身拒绝时返回带
  `Retry-After` 的结构化 JSON 429。SSE、workspace/AI stream、WebSocket 与普通
  API 均不继承这些限制。
- Nginx 自身触发的请求体大小拒绝会返回带 `REQUEST_TOO_LARGE` 与
  `X-Request-Id` 的结构化 JSON 413；应用自身的结构化 413 会原样透传。
- immutable asset 缓存只保存成功的 200 响应；部署切换期间的 404 被明确排除，
  新构建就绪后可以重新获取。
- SSE、NDJSON、AI 或 WebSocket 响应开始前发生的网关错误，会与普通 API 一样返回
  结构化 `503` 和 `Retry-After`。数据流一旦开始，则由其原生协议负责终止语义。
- 保留精确匹配的 `/api/workspace/bootstrap/stream` 非缓冲配置；该路由会发送
  `X-Accel-Buffering: no`，并在传输有界 NDJSON 数据块之前立即刷新协议清单。
- 保留 `gzip_types` 中的 `application/x-ndjson`。直连 Node 和示例反向代理都会
  协商 gzip；未发送 `Accept-Encoding` 的客户端仍接收 identity 数据流。
  NDJSON 路由保持私有且使用 `no-store`，并尊重上游已有的 `Content-Encoding`。
  该路由有意不发送 `no-transform`，因为该指令会禁止已协商的压缩；SSE 端点继续
  使用 `no-transform` 并保持不压缩。

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
WinSW 模板固定 `TRUST_PROXY=loopback`，因为 IIS ARR 与应用同机；远程反代只能填写
该代理的精确可信私有子网。WinSW 失败后重启两次，随后执行 `none`，直至一小时失败
窗口重置；人工重启熔断服务前必须先检查日志。

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
sudo mkdir -p /etc/phd-atlas
sudo cp /opt/phd-atlas/.env.example /etc/phd-atlas/phd-atlas.env
sudo chmod 0600 /etc/phd-atlas/phd-atlas.env
# 编辑 /etc/phd-atlas/phd-atlas.env，设置 DOMAIN 和 PHD_ATLAS_BOOTSTRAP_TOKEN

# 安装 systemd 服务
sudo cp /opt/phd-atlas/deploy/linux/phd-atlas.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now phd-atlas
```

服务单元会在 `ExecStart` 上固定 `NODE_ENV=production`、`TRUST_PROXY=loopback` 与
1 GiB `RUNTIME_MEMORY_BUDGET_BYTES`。它**刻意不固定** `UV_THREADPOOL_SIZE`：
`tools/start-server.mjs` 会按主机 CPU 数推导 libuv 线程池大小，且只在该变量未设置时
才这么做；在此写死会让所有主机停留在公式下限。这是有意的安全边界：systemd 的
`EnvironmentFile=` 会覆盖
普通 `Environment=` 赋值，与两者书写顺序无关；而 `ExecStart` 最终执行的
`/usr/bin/env` 赋值不会被过期环境文件降级。因此该模板假设使用同机 Nginx 反代。
如果反代位于远端私有网络，应通过经审核的 unit override 把 `loopback` 替换为反代的
精确可信子网；仅修改 `/etc/phd-atlas/phd-atlas.env` 不会覆盖这一安全不变量。

默认 storage root 为 `/opt/phd-atlas/storage`，已被
`ReadWritePaths=/opt/phd-atlas` 覆盖。若 `PHD_ATLAS_STORAGE_ROOT` 指向外部路径，
必须先创建并设置正确 owner，再在同一个经审核 drop-in 中用 `ReadWritePaths=` 加入
该精确绝对路径。也可设置 `StateDirectory=phd-atlas`，同时使用
`PHD_ATLAS_STORAGE_ROOT=/var/lib/phd-atlas`。在 `ProtectSystem=strict` 下只改环境
变量会让外部路径按预期不可写，不是有效部署方式。

原生 unit 还会限制重启与资源故障：五分钟内最多启动六次；应用先用最多 20 秒排空，
再进入 40 秒的最终存储耐久性主恢复窗口，systemd 最终停止上限为 75 秒；默认使用
`MemoryHigh=768M`、`MemoryMax=1G`、
`TasksMax=256` 与 `CPUQuota=200%`。这些是可以覆盖的 systemd 默认值。
固定的 512 MiB 应用预算会把默认 hard 准入边界设为 448 MiB；距离 `MemoryHigh`
仍有 320 MiB，距离 `MemoryMax` 仍有 576 MiB，两者都大于当前最大 128 MiB 单次
reservation。执行
若要支撑 100 人生产容量，应随 OS/cgroup 上限一起提高应用预算，而不是继续使用
低资源模板。

| 在线人数 | `RUNTIME_MEMORY_BUDGET_BYTES` | 说明 |
| --- | --- | --- |
| ≤ 20 | `536870912`（512 MiB） | 适合小规格 VPS |
| ≤ 100 | `1073741824` – `2147483648`（1–2 GiB） | OS/cgroup 上限必须高于该预算 |

进程在没有 cgroup 限制时默认回退到 1024 MiB 应用预算。`/api/health` 现在会暴露
`eventLoopLagP50`、`eventLoopLagP99`、`rssBytes`、`memoryBudgetBytes` 与
`pressureLevel`，便于做容量检查。
`sudo systemctl edit phd-atlas`，把 `StartLimitIntervalSec`、`StartLimitBurst` 放在
`[Unit]` 下，把资源与停止时间覆盖项放在 `[Service]` 下，然后执行
`sudo systemctl daemon-reload && sudo systemctl restart phd-atlas`。必须让
`MemoryMax` 高于 `RUNTIME_MEMORY_BUDGET_BYTES`，否则内核可能在应用返回结构化内存
压力响应前直接杀死 worker。真实崩溃循环触发 start limit 后，应先检查 worker 诊断，
再执行 `sudo systemctl reset-failed phd-atlas`。

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

# 或 Admin 内更新（beta.6+）：管理后台 → 系统信息 → 系统更新 → 检查更新
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

Admin Release 包更新（beta.6+）：管理后台 → 系统信息 → 系统更新。
支持自动检查 GitHub Release 或手动上传 `.tar.gz`。从 Beta.5 或更早版本一次性
过渡到 Beta.6 时，必须在可信设备下载 Beta.6 Release 的 `.tar.gz`，再通过
**手动更新**上传；本次不要依赖旧版自动安装流程。

Beta.6 及后续更新包会直接从标准 package manifest 与 lockfile 自动收集全部生产
依赖，并随 Release 携带精确、经过完整性校验的依赖归档；旧版恢复和第三方安装脚本
仍可在有界时间内依次使用 npmjs、npmmirror、Yarn 兼容源及适用的 GitHub 镜像。

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

## 管理命令（所有平台统一使用 Docker Compose）

在包含已审核 `compose.yaml` 和 `.env` 的目录执行：

```bash
docker compose stop
docker compose start
docker compose restart
docker compose logs --tail 50 phd-atlas
docker compose exec phd-atlas sh
```

## 注意事项

1. **统一使用已配置的 HTTPS 域名访问**，避免 host policy 错误
2. **首次访问必须先提交私密 bootstrap token，再创建管理员账户**
3. 将 `DOMAIN` 设置为公网 HTTPS origin，例如 `https://phd.example.com`
4. 生产环境必须通过已审核的反向代理使用 HTTPS
5. 数据保存在 Docker 卷中，备份时需备份卷或挂载目录
6. `/admin` 初始化页支持亮色/暗色主题切换和语言切换（12 种语言）

## 验收检查

- `/api/health/live` 在 Node 进程存活时返回 200，仅用作容器/编排器存活探针
- `/api/health/ready` 仅在存储恢复完成、内存与外部数据库状态可安全接流量时
  返回 200，应作为负载均衡就绪探针（旧 `/api/health` 保持始终 200 的诊断面）
- `/api/health/ws` 仅在实例就绪时以 101 完成升级
- 全新安装显示 `/admin` 的初始化步骤，并带有主题和语言控制
- 数据库通过连接测试并在重启后保持数据
- 普通账户和管理员登录
- 创建、编辑、删除、上传、下载、导出均正常
- 可创建并验证完整工作空间备份的恢复
- PWA manifest 和 Service Worker 通过 HTTPS 加载
- SMTP 和 Web Push 分别通过测试
