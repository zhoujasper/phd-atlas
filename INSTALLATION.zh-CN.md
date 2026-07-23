# 安装和使用 PhD Atlas

[English](INSTALLATION.md) | [简体中文](INSTALLATION.zh-CN.md)

本指南安装公开的 `zhoujasper/phd-atlas` 版本，全程不需要访问私有
`phd-atlas-source` 仓库。

> [!WARNING]
> PhD Atlas 仍是 Beta。每次更新前都要备份完整工作空间，并把同一次部署的
> 代码/镜像版本、`storage/` 快照、外部数据库快照和
> `SETTINGS_ENCRYPTION_KEY` 一起保管。

## 选择安装方式

- **Docker Compose（推荐）：** 最短、最容易复现的生产路径。下一次成功发布
  Beta 时，工作流会同时构建 `linux/amd64` 和 `linux/arm64`；较早的镜像标签
  可能只有 `linux/amd64`，固定标签前请先在 GHCR 页面确认架构。
- **原生 Node.js：** 适合直接通过 systemd 或 WinSW 运行的服务器。完成下方
  首次使用说明后，继续阅读 [DEPLOYMENT.zh-CN.md](DEPLOYMENT.zh-CN.md)。
- **开发环境：** 克隆公开仓库，运行 `npm ci`，再运行 `npm run dev`。

## 使用 Docker 安装

### 1. 准备服务器

安装带 Compose 插件的 Docker Engine，或安装 Docker Desktop。确认客户端和
服务端都能工作：

```bash
docker version
docker compose version
```

只克隆公开仓库：

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
cp .env.example .env
```

PowerShell 使用：

```powershell
Copy-Item .env.example .env
```

### 2. 配置生产密钥

分别生成两个不同的随机值。只有 Docker 的 Bash 服务器可以直接使用 PhD Atlas
同款 Node 镜像，不需要在宿主机安装 Node.js：

```bash
printf 'JWT_SECRET='
docker run --rm node:24-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
printf 'SETTINGS_ENCRYPTION_KEY='
docker run --rm node:24-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

PowerShell 5.1 或更新版本不需要 Node.js 或 OpenSSL：

```powershell
function New-AtlasSecret {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
"JWT_SECRET=$(New-AtlasSecret)"
"SETTINGS_ENCRYPTION_KEY=$(New-AtlasSecret)"
```

编辑 `.env`，网址和主机名应使用以下格式：

```dotenv
BASE_URL=https://phd.example.com
CORS_ORIGIN=https://phd.example.com
ALLOWED_HOSTS=phd.example.com
TRUST_PROXY=loopback
```

`BASE_URL` 和 `CORS_ORIGIN` 是完整 HTTPS origin；`ALLOWED_HOSTS` 只填写主机名，
使用非标准端口时可带端口，但不能包含 `https://`。然后设置：

- `JWT_SECRET` 使用第一个随机值；
- `SETTINGS_ENCRYPTION_KEY` 使用第二个随机值；
- 按需修改 `APP_PORT` 和 `PHD_ATLAS_IMAGE`。

共用的 `.env.example` 还包含私有源版本使用的 `BOOTSTRAP_*` 变量。公开
`zhoujasper/phd-atlas` 构建会忽略它们；公共部署无需替换这些示例值，也可以从
自己的 `.env` 中删除这些行。

不能直接修改 `.env` 来轮换 `SETTINGS_ENCRYPTION_KEY`。数据库凭据、邮件/AI
密钥、上传文件及其他持久加密内容都依赖它；更换必须通过明确的迁移流程完成。

### 3. 拉取并启动

```bash
docker compose pull
docker compose up -d --wait
docker compose ps
docker compose logs --tail=100 phd-atlas
```

默认只监听 `127.0.0.1:4317`，请在前面配置 HTTPS 反向代理。项目提供的
Nginx 和 IIS 模板同时转发普通 HTTP 与 `/api/health/ws` WebSocket 健康通道。

在服务器本机检查服务（把域名替换为实际配置）：

```bash
curl -fsS \
  -H 'Host: phd.example.com' \
  -H 'X-Forwarded-Proto: https' \
  http://127.0.0.1:4317/api/health
```

## 首次进入 `/admin`

打开 `https://你的域名/admin`。全新公共安装会显示四步引导：

1. 创建首位管理员。
2. 选择并验证数据存储。
3. 验证系统 SMTP 邮箱。
4. 检查配置并创建工作空间。

公共版没有默认管理员密码。首位有效管理员创建后，一次性初始化入口永久关闭。

### 支持的数据库

| 引擎 | 默认 | 数据库账号所需权限 |
| --- | --- | --- |
| SQLite | 是 | 对目标 `.sqlite`/`.sqlite3` 文件及目录有写权限 |
| MySQL / MariaDB | 否 | 连接，以及在专用数据库中创建/查询/插入/更新 |
| PostgreSQL | 否 | 连接、创建/使用 schema、创建/查询/插入/更新表 |
| Microsoft SQL Server | 否 | 连接、创建/使用 schema、创建/查询/插入/更新表 |

Docker 中使用 SQLite 时，路径留空，或只使用
`/app/storage/*.sqlite`。其他容器路径如果没有额外挂载，会在重建后丢失。

外部数据库需要填写主机、端口、数据库、账号、密码、schema 和 TLS 选项。
MySQL 还提供明确的 MySQL 5.7.44 兼容检查。只有连接验证成功后，目标才会被准备。

PhD Atlas 把持久工作空间快照保存在单个 `phd_atlas_state` 表中；上传文件、
备份、数据库连接信息和自动生成的集成资料仍保存在 `storage/`。因此即使使用
MySQL、PostgreSQL 或 SQL Server，Docker 持久卷也不能删除。

### 数据库安全规则

- 首次初始化应使用专用且为空的目标数据库/schema。
- 不要把全新初始化直接指向已有 PhD Atlas `phd_atlas_state` 数据。
  初始化和 **保存并迁移** 都会把当前工作空间快照写入目标。
- 把已有安装迁移到另一台应用服务器时，应复制完整 `storage/` 目录/卷，并保留
  完全相同的 `SETTINGS_ENCRYPTION_KEY`。复制后的
  `database-connection.json` 会让新服务器安全地重新打开原外部数据源。
- 把当前工作空间迁移到新数据库引擎前，先创建并验证完整工作空间备份。然后进入
  **管理后台 → 系统配置 → 数据库连接**，选择引擎，先点 **测试连接**，
  再点 **保存并迁移**。
- 保存的数据库密码经过加密，浏览器永远不会读回明文。
- 容器中的 `localhost` 指容器本身。请使用另一个 Compose 服务名、可访问的
  DNS/IP，或通过 `host.docker.internal` 连接 Docker 宿主机数据库。

PostgreSQL 的 TLS 开关会加密传输并验证服务器证书链。如果数据库、SMTP 或其他
出站 TLS 服务使用自签名证书或私有 CA，应把 CA 的 PEM bundle 放进持久卷，
再让 Node.js 读取它：

```bash
docker compose exec phd-atlas mkdir -p /app/storage/certs
docker compose cp ./private-ca.pem phd-atlas:/app/storage/certs/private-ca.pem
```

然后在 `.env` 中加入以下值并重建服务：

```dotenv
NODE_EXTRA_CA_CERTS=/app/storage/certs/private-ca.pem
```

```bash
docker compose up -d --wait
```

仅把 CA 安装到 Docker 宿主机信任库，不会改变容器内 Node.js 使用的信任库。

## 开始使用

初始化完成后：

1. 在 `/` 使用管理员或普通账户登录。
2. 创建申请并填写学校、项目、导师、截止日期、状态和进度。
3. 在档案页签中管理材料清单、往来消息、奖学金、任务和时间线。
4. 按需配置个人邮箱、AI 服务、通知、日历订阅、分享和 PWA 安装。
5. 从管理后台创建完整工作空间备份，并在录入不可替代的数据前实际验证一次恢复。

## Docker 日常操作

查看状态和日志：

```bash
docker compose ps
docker compose logs -f phd-atlas
```

不删除数据地重启：

```bash
docker compose restart phd-atlas
```

刷新滚动 Beta 基础镜像：

```bash
docker compose pull
docker compose up -d --wait
```

需要可复现部署时，在 `.env` 中把 `PHD_ATLAS_IMAGE` 固定为已经发布的 Release
标签；例如在该版本发布后使用
`ghcr.io/zhoujasper/phd-atlas:0.1.0-beta.2`。如需密码学意义上的不可变镜像，
应使用 GHCR 提供的
`ghcr.io/zhoujasper/phd-atlas@sha256:<manifest-digest>`；便捷的 `sha-...`
仍然只是可移动标签。本项目有意不发布 `latest` 标签。

### beta.1 一次性引导

已经发布的 `v0.1.0-beta.1` 早于下方受保护更新流程。

- **Docker beta.1：** 在 `.env` 中把 `PHD_ATLAS_IMAGE` 改为已发布的
  `ghcr.io/zhoujasper/phd-atlas:0.1.0-beta.2` 镜像（或其 manifest digest），
  然后运行：

  ```bash
  docker compose pull phd-atlas
  docker compose up -d --wait phd-atlas
  ```

  这会替换容器运行时，但保留命名 `storage/` 卷。再次修改固定版本前，先验证
  版本和原数据。
- **Linux 或 Windows 原生 beta.1：** **不能**通过旧 Admin 卡片上传 beta.2。
  beta.1 Linux unit 使用 systemd 默认的 `KillMode=control-group`，且只允许写入
  `/opt/phd-atlas/storage`，所以独立助手会被杀死，也无权替换运行时；旧原生
  交接流程也早于 beta.2 的首次启动保护。请执行
  [部署指南中的停服、仅 Release 包引导](DEPLOYMENT.zh-CN.md#原生-beta1-到-beta2-一次性引导)。

安装进入 beta.2 或更高版本后，才使用下方 Admin 流程。

### 从 Admin 更新

从 beta.2 开始，公共版在 Docker、systemd 和 WinSW 中都支持同一套经过发布
流程生成的 GitHub Release 更新包：

1. 创建并验证完整工作空间备份，同时备份停止状态的 `storage/`。
2. 打开 **管理后台 → 系统信息 → 系统更新**。
3. 点击 **检查更新**，检查版本和 Release 链接，再点击 **安装 vX**。
4. 校验助手安装生产依赖并重启服务时会短暂断开。重新打开 Admin，确认显示
   版本、`/api/health` 和原应用数据都正确。

自动检查只访问固定的 `zhoujasper/phd-atlas` 公开 GitHub Releases。服务器只
接受一组匹配的更新包和 `.sha256` 资产，并限制大小、超时、重定向和下载主机；
外部 checksum 与内部 manifest 都验证成功后才安排安装。服务器无法访问 GitHub
时，可展开 **手动更新**，上传可信 Release 的 `.tar.gz` 资产。

自动下载更新包的上限是 15 分钟。无论自动或手动更新，浏览器都会等待最多
30 分钟，因为服务器要先完成包校验和更新前完整工作空间备份，之后才接受重启。
PhD Atlas 前面的每层反向代理都应设置至少 60 分钟的上游/读取超时。

助手在交接前会对受管理运行时做语法检查和 import 预检。通过后，候选版本默认
进入 30 秒首次启动试运行；若确认前失败或异常退出，项目提供的启动器会恢复
上一激活包或运行时快照并重试。若无法安全恢复，则写入
`storage/.update-runtime-invalid.json` 并拒绝启动应用，不会继续运行部分更新的
文件树。

Docker 镜像入口会在助手工作时保持容器运行。更新成功后，按内容寻址的激活包和
指针保存在 `/app/storage/active-update/`。如果容器以后从较旧基础镜像重建，
入口会重新校验并重放较新的激活包；版本相同或更高且验证成功的基础镜像会取代
旧激活包。整个流程不挂载、也不需要 Docker socket。

`docker compose pull && docker compose up -d --wait` 仍用于刷新或固定基础
镜像。回滚到旧 Beta 时必须同时恢复与其匹配的完整 `storage/` 和外部数据库
快照，否则激活包或新版本数据会破坏预期回滚。

### 备份 Docker 卷

先在应用中创建完整工作空间备份。如果还要复制停止状态的卷，应从正在运行的
容器解析真实 Compose 卷名，不要假设项目目录前缀：

```bash
container_id="$(docker compose ps -q phd-atlas)"
test -n "$container_id" || { echo "phd-atlas 容器未运行。" >&2; exit 1; }
volume_name="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/storage"}}{{.Name}}{{end}}{{end}}' "$container_id")"
test -n "$volume_name" || { echo "没有找到 /app/storage 卷。" >&2; exit 1; }
if ! docker compose stop phd-atlas; then
  echo "无法停止 phd-atlas 容器；本次没有创建备份。" >&2
  docker compose start phd-atlas || echo "服务无法重新启动。" >&2
  exit 1
fi
trap 'docker compose start phd-atlas' EXIT
backup_status=0
docker run --rm -v "${volume_name}:/data:ro" -v "$PWD:/backup" \
  alpine tar -czf /backup/phd-atlas-storage.tgz -C /data . || backup_status=$?
start_status=0
docker compose start phd-atlas || start_status=$?
trap - EXIT
if [ "$backup_status" -ne 0 ]; then
  echo "Docker 卷备份失败。" >&2
fi
if [ "$start_status" -ne 0 ]; then
  echo "备份命令已经结束，但服务无法重新启动。" >&2
fi
if [ "$backup_status" -ne 0 ] || [ "$start_status" -ne 0 ]; then exit 1; fi
```

PowerShell 用户可直接在 Docker Desktop 中执行等价的停止卷备份：

```powershell
$containerId = docker compose ps -q phd-atlas
if (-not $containerId) { throw "phd-atlas 容器不存在。" }
$volumeName = docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/storage"}}{{.Name}}{{end}}{{end}}' $containerId
if (-not $volumeName) { throw "没有找到 /app/storage 卷。" }
$backupPath = (Get-Location).Path
$failures = @()
try {
  docker compose stop phd-atlas
  if ($LASTEXITCODE -ne 0) {
    $failures += "无法停止 phd-atlas 容器；本次没有创建备份。"
  } else {
    docker run --rm `
      --mount "type=volume,source=$volumeName,target=/data,readonly" `
      --mount "type=bind,source=$backupPath,target=/backup" `
      alpine tar -czf /backup/phd-atlas-storage.tgz -C /data .
    if ($LASTEXITCODE -ne 0) { $failures += "Docker 卷备份失败。" }
  }
} finally {
  docker compose start phd-atlas
  if ($LASTEXITCODE -ne 0) { $failures += "服务无法重新启动。" }
}
if ($failures.Count -gt 0) { throw ($failures -join " ") }
```

如果仓库路径可由 Docker Desktop 访问，也可在 WSL 中直接执行上方 Bash 版本。

除非确定要永久删除整个工作空间，否则绝不能运行 `docker compose down -v`。

## 原生安装和反向代理

[DEPLOYMENT.zh-CN.md](DEPLOYMENT.zh-CN.md) 包含 Ubuntu、RHEL 兼容系统、
其他 Linux、Windows Server + IIS、Nginx、系统服务、升级和回滚的完整步骤。
从 beta.2 开始，Admin Release 检查和可信手动更新包同时支持项目提供的
Docker 入口与兼容的 systemd/WinSW 服务。

## 常见问题

- **Docker API 不可用：** 启动 Docker Desktop/Engine，再运行 `docker version`。
- **Compose 提示缺少 `.env`：** 复制 `.env.example`，替换公共部署所需的网址
  和密钥占位值，并确保 `.env` 不进入 Git。公共构建会忽略仅私有源版本使用的
  `BOOTSTRAP_*` 项。
- **容器不健康：** 查看 `docker compose logs phd-atlas`。无效密钥、无法连接
  已选外部数据库、错误的 Host/HTTPS 请求头都会让健康检查按安全策略失败。
- **Docker 内数据库连接失败：** 不要使用 `localhost`；检查数据库防火墙、
  账号权限、schema、端口和 TLS 要求。
- **反代后浏览器显示离线：** 确认 `/api/health/ws` 收到了 WebSocket Upgrade
  与 Connection 请求头。
- **无法连接 GitHub 检查 Release：** 允许出站 HTTPS 访问 `api.github.com`
  和 `release-assets.githubusercontent.com`，或在其他设备下载两个 Release
  资产后使用 **手动更新**。
- **Admin 更新请求提前断开：** 把反向代理上游/读取超时提高到至少 60 分钟。
  项目提供的 Nginx 模板使用 3600 秒；IIS ARR 也应设置为至少 3600 秒。
- **更新后没有恢复健康：** 查看 `docker compose logs phd-atlas`、
  容器卷内的 `/app/storage/last-update-result.json` 和
  `/app/storage/update-helper.log`。不要盲目删除更新标记；应恢复匹配的更新前
  `storage/` 与外部数据库快照，或从经过验证的相同/更高版本基础镜像重建后再次
  检查日志。
- **已保存凭据无法解密：** 恢复与数据匹配的 `SETTINGS_ENCRYPTION_KEY`，
  不能在已有加密存储上直接生成新密钥。
