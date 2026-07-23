# 部署 PhD Atlas

[English](DEPLOYMENT.md) | [简体中文](DEPLOYMENT.zh-CN.md)

本指南说明公开版 `zhoujasper/phd-atlas` 的生产服务、反向代理、升级、备份和
回滚。若要走最短的 Docker 安装路径并查看首次使用流程，请先阅读
[INSTALLATION.zh-CN.md](INSTALLATION.zh-CN.md)。

PhD Atlas 由一个 Node.js 进程运行：Express 同时提供 `/api` 和构建后的 React
应用。持久工作空间可以使用 SQLite、MySQL/MariaDB、PostgreSQL 或 Microsoft
SQL Server。无论选择哪种数据库，`storage/` 始终用于保存数据库连接信息
（其中密码字段加密）、上传文件、备份、更新包、缓存和自动生成的集成资料，
因此必须持久化。

> [!WARNING]
> 当前发布线仍是 Beta。运行时更新包会经过完整性校验并支持运行时代码回滚，
> 但不同 Beta 版本之间不保证数据库结构和已存数据兼容。每次部署或更新前，
> 必须验证完整工作空间备份，并把相互匹配的代码/镜像版本、`storage/` 快照、
> 外部数据库快照和 `SETTINGS_ENCRYPTION_KEY` 一起保管。

## 生产环境要求

- 推荐使用带 Compose 的 Docker Engine/Desktop；原生部署使用 64 位 Node.js
  24 LTS。Vite 8 技术上接受 Node `^20.19.0` 或 `>=22.12.0`，但本项目生产
  环境支持线为 Node 24 LTS。
- 为 `storage/` 提供持久本地磁盘。选择 SQLite 时，活动数据库也必须在该本地
  磁盘上，不能放到 NFS、SMB 或其他网络文件系统。
- 选择 MySQL/MariaDB、PostgreSQL 或 SQL Server 时，需要可访问的专用
  database/schema，以及能创建和更新 `phd_atlas_state` 表的账号。
- 在反向代理处提供 HTTPS。生产服务器会把普通 HTTP 重定向到 HTTPS，代理还
  必须为 `/api/health/ws` 转发 WebSocket Upgrade。
- 小型个人部署至少准备 1 GB 内存；`npm ci`、原生模块编译和
  `npm run build` 时需要预留更多内存。

## 生产环境配置

把 `.env.example` 复制为 `.env`。为 `JWT_SECRET` 和
`SETTINGS_ENCRYPTION_KEY` 分别生成不同随机值；只有 Docker 的服务器和
PowerShell 可直接使用
[安装指南中的命令](INSTALLATION.zh-CN.md#2-配置生产密钥)。网址和主机名必须
使用以下格式：

```dotenv
BASE_URL=https://phd.example.com
CORS_ORIGIN=https://phd.example.com
ALLOWED_HOSTS=phd.example.com
TRUST_PROXY=loopback
JWT_SECRET=请替换为独立随机值
SETTINGS_ENCRYPTION_KEY=请替换为另一个独立随机值
```

`BASE_URL` 和 `CORS_ORIGIN` 是完整 HTTPS origin；`ALLOWED_HOSTS` 只填写
主机名，使用非标准端口时可带端口，但不能包含 `https://`。不要把 `.env`
提交到版本控制。

共用的 `.env.example` 包含私有版使用的 `BOOTSTRAP_*` 项。公开
`zhoujasper/phd-atlas` 构建会忽略这些项，也不会提供默认管理员密码。绝不能
仅修改环境变量来轮换 `SETTINGS_ENCRYPTION_KEY`：持久数据库凭据、上传文件和
其他加密信封都依赖它，更换密钥必须通过明确的迁移流程完成。

首次启动后打开 `https://你的域名/admin`。公共版一次性初始化会创建首位
管理员、选择并测试数据存储、验证系统 SMTP 邮箱，并创建工作空间。首位有效
管理员创建后，初始化入口永久关闭。

## 数据库部署

首次 `/admin` 初始化和
**管理后台 → 系统配置 → 数据库连接** 支持：

| 引擎 | 推荐部署方式 |
| --- | --- |
| SQLite | 默认；文件放在持久 `storage/` 下 |
| MySQL / MariaDB | 使用专用 database；可显式检查 MySQL 5.7.44 兼容性 |
| PostgreSQL | 使用专用 database/schema；SSL 会验证服务器证书链 |
| Microsoft SQL Server | 使用专用 database/schema |

外部数据库把当前工作空间快照保存在单个 `phd_atlas_state` 表中。上传和运维
文件不会进入这张表，因此外部数据库不能替代 `storage/` 卷或目录。

首次初始化应使用专用且为空的目标。全新初始化和 **保存并迁移** 都会把当前
工作空间写入目标；不能用这两个流程“接管”已有 `phd_atlas_state` 数据。
把已有安装迁移到另一台应用服务器时，要复制完整 `storage/` 目录/卷，并保留
完全相同的 `SETTINGS_ENCRYPTION_KEY`。新服务器随后可通过复制来的
`storage/database-connection.json`（其中密码字段加密）重新连接原外部数据库。

切换数据库引擎前，先创建并验证完整工作空间备份。然后选择新引擎，执行
**测试连接**，最后再执行 **保存并迁移**。PostgreSQL SSL 会验证证书链。
使用自签名证书或私有 CA 时，应把 PEM bundle 放到持久
`storage/certs/` 下，把 `NODE_EXTRA_CA_CERTS` 设置为容器内或原生部署中的
绝对路径，再重启进程。仅把 CA 安装到 Docker 宿主机信任库，不会改变容器内
Node.js 使用的信任库。

字段和容器网络细节见
[支持的数据库和安全规则](INSTALLATION.zh-CN.md#支持的数据库)。

## Docker Compose（推荐）

公开的预构建镜像位于
[`ghcr.io/zhoujasper/phd-atlas`](https://github.com/zhoujasper/phd-atlas/pkgs/container/phd-atlas)；
使用它不需要访问 `phd-atlas-source`，也不需要登录 GitHub。只需克隆公开仓库
以取得 `compose.yaml` 和 `.env.example`：

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
cp .env.example .env
# 继续前先编辑 .env。
docker compose pull
docker compose up -d --wait
docker compose ps
docker compose logs --tail=100 phd-atlas
```

PowerShell 用 `Copy-Item .env.example .env` 替代 `cp`。

`compose.yaml` 默认使用滚动的
`ghcr.io/zhoujasper/phd-atlas:beta` 通道。本项目有意不发布 `latest` 标签。
为了可复现部署，在 `.env` 中把 `PHD_ATLAS_IMAGE` 固定为已经发布的预发布
标签；例如在该版本发布后使用
`ghcr.io/zhoujasper/phd-atlas:0.1.0-beta.2`。如需密码学意义上的不可变部署，
应使用 GHCR 提供的
`ghcr.io/zhoujasper/phd-atlas@sha256:<manifest-digest>`；便捷的 `sha-...`
仍然可以被移动。

下一次成功发布 Beta 时，工作流已配置为同时构建 `linux/amd64` 和
`linux/arm64`。较早标签可能只有 `linux/amd64`，固定版本前请在 GHCR 检查
该标签的 manifest。

Compose 默认只把应用绑定到 `127.0.0.1:4317`。Bash 和 PowerShell 都可以
通过编辑 `.env` 修改宿主机端口：

```dotenv
APP_PORT=8080
```

然后重新运行 `docker compose up -d --wait`；容器内部仍监听 4317。

即使选择外部数据库，也必须保留挂载到 `/app/storage` 的命名卷。容器中的
`localhost` 指容器本身。请使用另一个 Compose 服务名、可访问的 DNS/IP，
或使用 `host.docker.internal` 连接 Docker 宿主机数据库；项目自带的 Compose
文件已经配置 host-gateway 映射。

从 beta.2 开始，Docker 支持两种升级方式：

- **Admin Release 更新：** 检查固定的公开 GitHub Releases，或手动上传可信
  `.tar.gz` 资产。容器入口会保持运行，让更新助手替换并重启服务器 worker。
- **基础镜像更新：** 拉取已发布镜像，再依次运行 `docker compose pull` 和
  `docker compose up -d --wait` 重建服务。

使用预构建 `image:` 配置时不要添加 `--build`。除非确定要永久删除整个工作
空间，否则绝不能运行
`docker compose down -v`。Bash 和 PowerShell 的安全停止卷备份方法见
[备份 Docker 卷](INSTALLATION.zh-CN.md#备份-docker-卷)，容器重放模型见
[从 Admin 更新](INSTALLATION.zh-CN.md#从-admin-更新)。

## Ubuntu Server

以下原生安装命令适用于 Ubuntu 22.04/24.04 或更新版本。

1. 安装 Node.js 24 LTS、Git、编译工具和 Nginx。例如：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential python3 nginx
node --version
```

确认 `node --version` 输出 v24。

2. 创建非特权服务账户并安装公开版：

```bash
sudo useradd --system --home /opt/phd-atlas --shell /usr/sbin/nologin phd-atlas
sudo git clone https://github.com/zhoujasper/phd-atlas.git /opt/phd-atlas
sudo chown -R phd-atlas:phd-atlas /opt/phd-atlas
sudo -u phd-atlas bash -lc 'cd /opt/phd-atlas && npm ci && npm run build && npm prune --omit=dev'
sudo install -d -o phd-atlas -g phd-atlas /opt/phd-atlas/storage
sudo install -d -m 0750 /etc/phd-atlas
sudo cp /opt/phd-atlas/.env.example /etc/phd-atlas/phd-atlas.env
sudo chmod 0600 /etc/phd-atlas/phd-atlas.env
sudoedit /etc/phd-atlas/phd-atlas.env
```

自定义 SQLite 路径应放在 `/opt/phd-atlas/storage` 下。若使用其他位置，需要
同时配置正确的所有权并明确修改 systemd 的 `ReadWritePaths`。

3. 安装并启动项目提供的 unit：

```bash
sudo cp /opt/phd-atlas/deploy/linux/phd-atlas.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now phd-atlas
sudo systemctl status phd-atlas
curl -H 'Host: phd.example.com' \
  -H 'X-Forwarded-Proto: https' \
  http://127.0.0.1:4317/api/health
```

项目提供的 unit 有意使用 `Restart=on-failure`、`KillMode=process`，并允许
写入 `/opt/phd-atlas`。Admin 更新器会启动独立的完整性校验助手，再让主进程
以失败状态退出；这些配置让助手继续完成更新，同时 systemd 通过更新锁等待并
重新启动服务。如果需要保留 Admin 更新功能，不要把 unit 收紧到会杀死助手或
让受管理运行时变成只读。

4. 把 `deploy/nginx/phd-atlas.conf` 复制到
`/etc/nginx/sites-available/phd-atlas`，替换示例域名和证书路径，启用并校验：

```bash
sudo ln -s /etc/nginx/sites-available/phd-atlas /etc/nginx/sites-enabled/phd-atlas
sudo nginx -t
sudo systemctl reload nginx
```

模板设置 550 MiB 请求限制，转发原始 Host 和 scheme、WebSocket
Upgrade/Connection 请求头，并允许上游读取保持 3600 秒。Admin 更新请求应保留
60 分钟的上游/读取超时。对外开放服务前必须取得有效 TLS 证书。

## CentOS Stream / RHEL 兼容 Linux

使用 CentOS Stream 9/10 或仍受支持的 RHEL 兼容发行版。不要在新的互联网
服务上使用已停止支持的 CentOS Linux 7。

1. 安装 Node.js 24 LTS 和原生编译工具：

```bash
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs git gcc-c++ make python3 nginx
node --version
```

2. 按 Ubuntu 部分完成服务账户、克隆、构建、环境变量和 systemd 步骤。
   Nginx 模板通常放到 `/etc/nginx/conf.d/phd-atlas.conf`；应删除或调整
   Debian 的 `sites-available` 步骤。
3. 配置证书后开放 HTTPS 并启动服务：

```bash
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
sudo nginx -t
sudo systemctl enable --now nginx phd-atlas
```

SELinux 强制模式下，如果 Nginx 无法连接本地 Node 进程：

```bash
sudo setsebool -P httpd_can_network_connect 1
```

## 其他 Linux 发行版

通过发行版支持的软件包安装 Node.js 24 LTS、Git、Python 3、`make`、C++
编译器和 HTTPS 反向代理。systemd 系统可使用项目提供的 unit。原生构建顺序为：

```bash
npm ci
npm run build
npm prune --omit=dev
NODE_ENV=production node tools/start-server.mjs
```

必须使用专用非特权账户运行、加载生产环境、持久化 `storage/`，并把 HTTPS
反向代理到 `127.0.0.1:4317`。自定义进程管理器必须在更新器的非零退出后重启、
允许独立助手继续运行，并通过 `tools/start-server.mjs` 启动，以正确等待更新锁。

## Windows Server

支持的原生结构为 Node.js 24 LTS + WinSW + 带 ARR、URL Rewrite 和 IIS
WebSocket Protocol 功能的 IIS。

1. 安装 64 位 Node.js 24 LTS、Git、IIS WebSocket Protocol、URL Rewrite 2
   和 Application Request Routing（ARR）。
2. 克隆公开仓库，在管理员 PowerShell 中构建：

```powershell
git clone https://github.com/zhoujasper/phd-atlas.git C:\PhDAtlas
Set-Location C:\PhDAtlas
Copy-Item .env.example .env
notepad .env
npm ci
npm run build
npm prune --omit=dev
```

3. 从 WinSW 官方 Release 下载当前稳定可执行文件，保存为
   `C:\PhDAtlas\PhDAtlas.exe`，再把
   `deploy\windows\PhDAtlas.xml.example` 复制为
   `C:\PhDAtlas\PhDAtlas.xml`。模板通过 `tools\start-server.mjs` 启动，在
   更新请求后重新运行服务，并让启动器读取项目 `.env`。
4. 安装并验证服务：

```powershell
Set-Location C:\PhDAtlas
.\PhDAtlas.exe install
.\PhDAtlas.exe start
.\PhDAtlas.exe status
```

5. 在 IIS ARR 中启用代理并保留原始 Host Header。把
   `HTTP_X_FORWARDED_PROTO` 加入允许的服务器变量。将
   `deploy\windows\web.config.example` 复制到 IIS 代理站点的
   `web.config`，绑定有效 HTTPS 证书，并把站点目录指向只包含该文件的小型目录：

```powershell
& $env:windir\System32\inetsrv\appcmd.exe set config `
  /section:system.webServer/proxy /enabled:true /preserveHostHeader:true
```

模板会启用 WebSocket 转发，并把 IIS 请求上限提高到 550 MiB。
在 IIS 管理器中打开服务器的 **Application Request Routing Cache → Server
Proxy Settings**，把 **Time-out (seconds)** 设置为至少 `3600`。
`BASE_URL` 和 `CORS_ORIGIN` 填完整 IIS HTTPS origin，`ALLOWED_HOSTS` 只填
不带 scheme 的主机名，并设置 `TRUST_PROXY=loopback`。

## 反向代理验证

完成 Nginx、IIS、Caddy、Traefik 或其他代理配置后：

```bash
curl -fsS https://phd.example.com/api/health
```

还要打开应用，并确认浏览器对
`wss://phd.example.com/api/health/ws` 收到 `101 Switching Protocols`。
普通 HTTP GET 访问该端点会有意返回 `426`，不能把它当成 WebSocket 成功检查。

应保留原始 Host Header 和 HTTPS scheme。反向代理与程序位于同一主机时，不要
把 4317 端口直接暴露到公网。Admin 更新请求的上游/读取超时应设置为 60 分钟：
Release 下载最多可占用服务器 15 分钟；浏览器会为下载或上传、包校验和更新前
完整工作空间备份等待 30 分钟。较短的代理默认值可能让浏览器在服务器返回校验
结果前断开。

## 备份与回滚

应同时使用两层备份：

1. **Admin 完整工作空间归档：** 包含 SQLite 热备兼容镜像和上传文件。使用
   外部数据库时，还包含 `phd_atlas_state` 的对应引擎 SQL 表示。恢复前必须先
   选择创建该备份时使用的同一种数据库 adapter。
2. **基础设施快照：** 停止应用后复制完整 `storage/` 目录/卷；使用外部数据库
   时还要同时创建数据库快照。

两层备份都要附带相同部署的加密密钥和精确 Release/镜像标识。SQLite 的
WAL/SHM 文件属于活动数据库状态；应使用 Admin 热备，或在停止应用后复制整个
`storage/`，绝不能只复制一个 `.sqlite` 文件。

Beta 回滚时，要停止应用，并把上一代码/镜像、与其匹配的完整 `storage/` 快照、
外部数据库快照和 `SETTINGS_ENCRYPTION_KEY` 作为同一组恢复。只回滚运行时代码
可能会让旧代码读取到不兼容的新 Beta 数据。

## 升级方式

### Docker 基础镜像

```bash
docker compose pull
docker compose up -d --wait
docker compose ps
```

受控生产变更应记录已发布的 Release 标签；需要固定镜像时，应使用其
`@sha256:<manifest-digest>` 引用。

基础镜像不是唯一的持久更新状态。Admin 更新成功后，会在
`storage/active-update/` 下保存按内容寻址的 Release 包和指针。容器重建时，
入口会验证不可变镜像运行时：激活包版本高于基础镜像时重新重放；基础镜像版本
相同或更高且验证成功时，以基础镜像为准并归档旧激活指针。必须把同一部署的
`storage/` 快照和镜像引用一起保管。

### 原生手动升级

这条源码检出升级路径只适用于主动维护公共 Git 仓库的运维者，不是下一节的
beta.1 Release 包引导。完成上述备份后：

```bash
sudo systemctl stop phd-atlas
cd /opt/phd-atlas
sudo -u phd-atlas git pull --ff-only
sudo -u phd-atlas npm ci
sudo -u phd-atlas npm run build
sudo -u phd-atlas npm prune --omit=dev
sudo systemctl start phd-atlas
```

Windows 上先停止 WinSW，在 `C:\PhDAtlas` 更新并构建，再启动服务。

### 原生 beta.1 到 beta.2 一次性引导

原生 `v0.1.0-beta.1` 安装不能把 beta.2 提交给 Admin 更新卡片。该版本的 Linux
unit 使用 systemd 默认 `KillMode=control-group`，服务器退出时会连同独立助手
一起杀死；同时 `ProtectSystem=strict` 只允许写入 `/opt/phd-atlas/storage`，
助手无权替换运行时。beta.1 原生交接流程也早于 beta.2 的首次启动恢复。

以下一次性流程只使用 beta.2 Release 发布的两个资产，以及 beta.1 安装目录里
已有的校验器/助手；不克隆或拉取源代码仓库。开始前：

1. beta.1 仍在运行时，先从 Admin 创建并验证完整工作空间备份。
2. 使用外部数据库时，准备可由同一引擎和 adapter 恢复的数据库原生快照。
3. 确认已有 Node.js 24、`npm`、原生构建工具链、`curl`、`tar`，并有足够空间
   再保存一份 `storage/` 和 `node_modules`。
4. 等待 `v0.1.0-beta.2` 及两个确定性 Release 资产正式发布；不能替换为 Issue、
   fork 或聊天消息中的文件。

#### 标准 systemd 布局

以下命令针对项目提供的 `/opt/phd-atlas` 和
`/etc/phd-atlas/phd-atlas.env` 布局。它通过 HTTPS 下载，检查已发布 sidecar
和内部精确版本，拒绝危险归档路径，然后停止服务、创建独立停止态备份，并在旧
systemd 沙箱之外手工调用已安装的 beta.1 助手：

```bash
set -euo pipefail

release_version='0.1.0-beta.2'
release_tag="v${release_version}"
asset="phd-atlas-update-${release_version}-release.tar.gz"
release_root="https://github.com/zhoujasper/phd-atlas/releases/download/${release_tag}"
app_root='/opt/phd-atlas'
download_root="$(mktemp -d /tmp/phd-atlas-beta2.XXXXXX)"

cleanup_download() {
  case "$download_root" in
    /tmp/phd-atlas-beta2.*) rm -rf -- "$download_root" ;;
    *) echo "Refusing to remove unexpected path: $download_root" >&2 ;;
  esac
}
trap cleanup_download EXIT

current_version="$(
  sudo -u phd-atlas /usr/bin/node \
    -e "process.stdout.write(require('/opt/phd-atlas/package.json').version)"
)"
if [ "$current_version" != '0.1.0-beta.1' ]; then
  echo "This bootstrap requires beta.1; found $current_version." >&2
  exit 1
fi
if [ -e "$app_root/storage/.update-in-progress.json" ]; then
  echo 'An earlier update is unresolved. Restore/repair beta.1 before continuing.' >&2
  exit 1
fi
if ! sudo -u phd-atlas test -w "$app_root"; then
  echo 'The phd-atlas account cannot modify /opt/phd-atlas.' >&2
  exit 1
fi

curl --fail --location --proto '=https' --proto-redir '=https' \
  --output "$download_root/$asset" "$release_root/$asset"
curl --fail --location --proto '=https' --proto-redir '=https' \
  --output "$download_root/$asset.sha256" "$release_root/$asset.sha256"

checksum_line="$(tr -d '\r\n' < "$download_root/$asset.sha256")"
if [[ ! "$checksum_line" =~ ^([0-9a-fA-F]{64})[[:space:]]+\*?([^[:space:]]+)$ ]]; then
  echo 'The Release checksum sidecar is malformed.' >&2
  exit 1
fi
if [ "${BASH_REMATCH[2]}" != "$asset" ]; then
  echo 'The Release checksum sidecar names another file.' >&2
  exit 1
fi
actual_hash="$(sha256sum "$download_root/$asset" | awk '{print $1}')"
if [ "${BASH_REMATCH[1],,}" != "${actual_hash,,}" ]; then
  echo 'The Release package SHA-256 does not match its sidecar.' >&2
  exit 1
fi

archive_entries="$(tar -tzf "$download_root/$asset")"
if printf '%s\n' "$archive_entries" | grep -Eq '(^/)|(^|/)\.\.(/|$)|\\'; then
  echo 'The Release archive contains an unsafe path.' >&2
  exit 1
fi

manifest_json="$(
  tar -xOf "$download_root/$asset" ./update-manifest.json 2>/dev/null \
    || tar -xOf "$download_root/$asset" update-manifest.json
)"
manifest_version="$(
  printf '%s' "$manifest_json" |
    node -e "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const m=JSON.parse(s);if(m.formatVersion!==1||m.appId!=='phd-atlas')process.exit(2);process.stdout.write(String(m.version||''))})"
)"
if [ "$manifest_version" != "$release_version" ]; then
  echo "Manifest version $manifest_version does not match $release_version." >&2
  exit 1
fi

sudo systemctl stop phd-atlas
if sudo systemctl is-active --quiet phd-atlas; then
  echo 'phd-atlas is still running; refusing to replace its runtime.' >&2
  exit 1
fi

backup_dir="/var/backups/phd-atlas/beta1-to-beta2-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 0700 "$backup_dir/runtime"
for entry in dist server tools node_modules package.json package-lock.json; do
  if [ ! -e "$app_root/$entry" ]; then
    echo "Required beta.1 runtime entry is missing: $entry" >&2
    exit 1
  fi
  sudo cp -a "$app_root/$entry" "$backup_dir/runtime/$entry"
done
sudo cp -a /etc/systemd/system/phd-atlas.service "$backup_dir/phd-atlas.service"
sudo cp -a /etc/phd-atlas/phd-atlas.env "$backup_dir/phd-atlas.env"
if [ -f "$app_root/.env" ]; then
  sudo cp -a "$app_root/.env" "$backup_dir/project.env"
fi
sudo tar -C "$app_root" -czf "$backup_dir/storage.tar.gz" storage
echo "Stopped beta.1 backup: $backup_dir"

bootstrap_package="$app_root/storage/update-packages/$asset"
sudo install -d -o phd-atlas -g phd-atlas "$app_root/storage/update-packages"
sudo install -o phd-atlas -g phd-atlas -m 0600 \
  "$download_root/$asset" "$bootstrap_package"

cd "$app_root"
sudo -u phd-atlas /usr/bin/node tools/apply-update.mjs \
  --package "$bootstrap_package" \
  --pid 0

sudo tee /etc/systemd/system/phd-atlas.service >/dev/null <<'UNIT'
[Unit]
Description=PhD Atlas
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=phd-atlas
Group=phd-atlas
WorkingDirectory=/opt/phd-atlas
EnvironmentFile=/etc/phd-atlas/phd-atlas.env
ExecStart=/usr/bin/node tools/start-server.mjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=35
KillSignal=SIGTERM
KillMode=process
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/phd-atlas

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl start phd-atlas
sudo systemctl is-active --quiet phd-atlas
installed_version="$(
  sudo -u phd-atlas /usr/bin/node \
    -e "process.stdout.write(require('/opt/phd-atlas/package.json').version)"
)"
if [ "$installed_version" != "$release_version" ]; then
  echo "Installed version is $installed_version, expected $release_version." >&2
  exit 1
fi
echo "PhD Atlas $installed_version is running. Backup retained at $backup_dir"
```

beta.1 助手会验证 manifest 中列出的每个运行时文件并执行
`npm ci --omit=dev`；若该步骤失败，它会尝试恢复自身创建的运行时快照。上方
独立备份仍不可省略。脚本不会替换 `storage/`、
`/etc/phd-atlas/phd-atlas.env`、项目 `.env` 或加密密钥。由于这次交接由
beta.1 助手发起，它不会创建 beta.2 的待确认首启试运行；独立备份以及启动后的
健康与数据检查都是必需步骤。成功后检查公网 `/api/health`、显示版本、日志和
一次代表性读写。

若命令在服务停止后中断，保持服务停止，并检查
`storage/last-update-result.json` 与 `storage/update-helper.log`。重新启动前，
先恢复输出路径中的运行时备份和旧 unit；若 beta.2 已经启动或写入数据，还要同时
恢复匹配的停止态 `storage/` 归档与外部数据库快照，不能把 beta.1 运行时和
beta.2 数据混用。

#### 标准 WinSW 布局

在提升权限的 PowerShell 中对项目提供的 `C:\PhDAtlas` 布局执行下方命令。
它使用 beta.1 tag 中的验证器校验并解包，停止 WinSW，只复制 manifest 已验证
的运行时文件，直接执行 `npm.cmd ci`，保留 `.env` 与 `storage`，并写入兼容
beta.2 的标准 WinSW 配置。它不会调用 beta.1 的 Windows 安装器：

```powershell
$ErrorActionPreference = 'Stop'
$null = Get-Command curl.exe -ErrorAction Stop
$null = Get-Command tar.exe -ErrorAction Stop

$releaseVersion = '0.1.0-beta.2'
$releaseTag = "v$releaseVersion"
$asset = "phd-atlas-update-$releaseVersion-release.tar.gz"
$releaseRoot = "https://github.com/zhoujasper/phd-atlas/releases/download/$releaseTag"
$expectedRoot = 'C:\PhDAtlas'
$appRoot = (Resolve-Path -LiteralPath $expectedRoot).Path.TrimEnd('\')
if (-not $appRoot.Equals($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "This block only supports the standard $expectedRoot layout."
}
$nodeExe = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "Node.js 24 was not found at $nodeExe."
}
$npmCmd = 'C:\Program Files\nodejs\npm.cmd'
if (-not (Test-Path -LiteralPath $npmCmd)) {
  throw "npm was not found at $npmCmd."
}

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$workDir = Join-Path $tempBase ("phd-atlas-beta2-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workDir | Out-Null

try {
  Push-Location $appRoot
  try {
    $currentVersion = & $nodeExe `
      -e "process.stdout.write(require('./package.json').version)"
  } finally {
    Pop-Location
  }
  if ($currentVersion -ne '0.1.0-beta.1') {
    throw "This bootstrap requires beta.1; found $currentVersion."
  }
  if (Test-Path -LiteralPath (Join-Path $appRoot 'storage\.update-in-progress.json')) {
    throw 'An earlier update is unresolved. Restore/repair beta.1 first.'
  }

  $packagePath = Join-Path $workDir $asset
  $checksumPath = "$packagePath.sha256"
  & curl.exe --fail --location --proto '=https' --proto-redir '=https' `
    --output $packagePath "$releaseRoot/$asset"
  if ($LASTEXITCODE -ne 0) { throw 'Unable to download the Release package.' }
  & curl.exe --fail --location --proto '=https' --proto-redir '=https' `
    --output $checksumPath "$releaseRoot/$asset.sha256"
  if ($LASTEXITCODE -ne 0) { throw 'Unable to download the checksum sidecar.' }

  $checksumLine = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
  $checksumMatch = [regex]::Match(
    $checksumLine,
    '^(?<hash>[0-9a-fA-F]{64})\s+\*?(?<name>[^\s]+)\s*$'
  )
  if (-not $checksumMatch.Success -or $checksumMatch.Groups['name'].Value -ne $asset) {
    throw 'The Release checksum sidecar is malformed or names another file.'
  }
  $actualHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
  if (-not $actualHash.Equals(
    $checksumMatch.Groups['hash'].Value,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw 'The Release package SHA-256 does not match its sidecar.'
  }

  $archiveEntries = @(& tar -tzf $packagePath)
  if ($LASTEXITCODE -ne 0) { throw 'Unable to list the Release package.' }
  foreach ($entry in $archiveEntries) {
    if (
      $entry.StartsWith('/') -or
      $entry.StartsWith('\') -or
      $entry -match '(^|[\\/])\.\.([\\/]|$)'
    ) {
      throw "The Release archive contains an unsafe path: $entry"
    }
  }

  $validatorScript = Join-Path $workDir 'validate-update.mjs'
  @'
import { pathToFileURL } from 'node:url'
const [modulePath, packagePath, workRoot] = process.argv.slice(2)
const module = await import(pathToFileURL(modulePath).href)
const validated = await module.validateUpdatePackage(packagePath, workRoot)
process.stdout.write(JSON.stringify(validated))
'@ | Set-Content -LiteralPath $validatorScript -Encoding UTF8
  $validationRoot = Join-Path $workDir 'validation'
  $systemUpdateModule = Join-Path $appRoot 'server\systemUpdate.js'
  $validationJson = @(
    & $nodeExe $validatorScript $systemUpdateModule $packagePath $validationRoot
  )
  if ($LASTEXITCODE -ne 0) {
    throw 'The beta.1 validator rejected the Release package.'
  }
  $validated = ($validationJson -join "`n") | ConvertFrom-Json
  $manifest = $validated.manifest
  if (
    $manifest.formatVersion -ne 1 -or
    $manifest.appId -ne 'phd-atlas' -or
    $manifest.version -ne $releaseVersion
  ) {
    throw 'The update manifest is not the expected PhD Atlas beta.2 package.'
  }
  $extractRoot = [IO.Path]::GetFullPath([string]$validated.extractRoot).TrimEnd('\')
  $expectedValidationRoot = [IO.Path]::GetFullPath($validationRoot).TrimEnd('\')
  if (-not $extractRoot.StartsWith(
    "$expectedValidationRoot\",
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "The validator returned an unexpected extraction path: $extractRoot"
  }
  $manifestPaths = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )
  foreach ($file in @($manifest.files)) {
    $relativePath = [string]$file.path
    if (
      $relativePath.Contains('\') -or
      $relativePath.StartsWith('/') -or
      $relativePath.StartsWith('./') -or
      $relativePath.Contains('//') -or
      $relativePath -match '(^|/)\.\.(/|$)' -or
      (
        $relativePath -ne 'package.json' -and
        $relativePath -ne 'package-lock.json' -and
        $relativePath -notmatch '^(dist|server|tools)/.+'
      ) -or
      -not $manifestPaths.Add($relativePath)
    ) {
      throw "The manifest contains an unsafe or duplicate path: $relativePath"
    }
  }

  Push-Location $appRoot
  try {
    & .\PhDAtlas.exe stop
    if ($LASTEXITCODE -ne 0) { throw 'WinSW could not stop PhD Atlas.' }
  } finally {
    Pop-Location
  }
  $service = Get-Service -Name 'PhDAtlas'
  $service.Refresh()
  if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
    throw 'PhD Atlas is still running; refusing to replace its runtime.'
  }

  $backupRoot = "C:\PhDAtlas-backups\beta1-to-beta2-$(
    [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  )"
  $runtimeBackup = Join-Path $backupRoot 'runtime'
  New-Item -ItemType Directory -Path $runtimeBackup -Force | Out-Null
  foreach ($entry in @(
    'dist', 'server', 'tools', 'node_modules', 'package.json', 'package-lock.json'
  )) {
    $source = Join-Path $appRoot $entry
    if (-not (Test-Path -LiteralPath $source)) {
      throw "Required beta.1 runtime entry is missing: $entry"
    }
    Copy-Item -LiteralPath $source `
      -Destination (Join-Path $runtimeBackup $entry) -Recurse -Force
  }
  Copy-Item -LiteralPath (Join-Path $appRoot 'storage') `
    -Destination (Join-Path $backupRoot 'storage') -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $appRoot 'PhDAtlas.xml') `
    -Destination (Join-Path $backupRoot 'PhDAtlas.xml') -Force
  if (Test-Path -LiteralPath (Join-Path $appRoot '.env')) {
    Copy-Item -LiteralPath (Join-Path $appRoot '.env') `
      -Destination (Join-Path $backupRoot '.env') -Force
  }
  Write-Host "Stopped beta.1 backup: $backupRoot"

  $packageRoot = Join-Path $appRoot 'storage\update-packages'
  New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
  $bootstrapPackage = Join-Path $packageRoot $asset
  Copy-Item -LiteralPath $packagePath -Destination $bootstrapPackage -Force

  Push-Location $appRoot
  try {
    foreach ($entry in @('dist', 'server', 'tools')) {
      Remove-Item -LiteralPath (Join-Path $appRoot $entry) -Recurse -Force
    }
    foreach ($file in @($manifest.files)) {
      $relativePath = [string]$file.path
      $source = Join-Path $extractRoot $relativePath.Replace('/', '\')
      $destination = Join-Path $appRoot $relativePath.Replace('/', '\')
      New-Item -ItemType Directory -Path (Split-Path -Parent $destination) `
        -Force | Out-Null
      Copy-Item -LiteralPath $source -Destination $destination -Force
    }
    & $npmCmd ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      throw 'npm could not install the beta.2 production dependencies.'
    }

    @'
<service>
  <id>PhDAtlas</id>
  <name>PhD Atlas</name>
  <description>PhD Atlas application server</description>
  <executable>C:\Program Files\nodejs\node.exe</executable>
  <arguments>tools\start-server.mjs</arguments>
  <workingdirectory>%BASE%</workingdirectory>
  <env name="NODE_ENV" value="production" />
  <env name="PORT" value="4317" />
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <stoptimeout>35 sec</stoptimeout>
  <logpath>%BASE%\logs\service</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
</service>
'@ | Set-Content -LiteralPath .\PhDAtlas.xml -Encoding UTF8

    & .\PhDAtlas.exe start
    if ($LASTEXITCODE -ne 0) { throw 'WinSW could not start PhD Atlas.' }
    $installedVersion = & $nodeExe `
      -e "process.stdout.write(require('./package.json').version)"
    if ($installedVersion -ne $releaseVersion) {
      throw "Installed version is $installedVersion, expected $releaseVersion."
    }
    Write-Host "PhD Atlas $installedVersion is running. Backup: $backupRoot"
  } finally {
    Pop-Location
  }
} finally {
  $resolvedWork = [IO.Path]::GetFullPath($workDir).TrimEnd('\')
  if (-not $resolvedWork.StartsWith(
    "$tempBase\",
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Refusing to remove unexpected path: $resolvedWork"
  }
  Remove-Item -LiteralPath $resolvedWork -Recurse -Force
}
```

如果使用自定义 WinSW 服务账号，启用后续 Admin 更新前，应确认它对受管理的
`C:\PhDAtlas` 运行时和 `storage` 都有 Modify 权限。Windows 命令刻意不调用
beta.1 安装器，因为该 tag 中的 helper 在当前 Windows Node 运行时启动
`npm.cmd` 时可能失败。若命令在停止服务后失败，保持服务停止并恢复输出路径中的
运行时和 WinSW 配置；若 beta.2 已经运行，还要恢复匹配的 `storage` 与外部
数据库快照，再重新启动。

### Admin Release 更新（Docker 和原生部署）

带标签的公共 GitHub Release 会附带
`phd-atlas-update-<version>-release.tar.gz` 和对应 `.sha256` 文件。
本节只适用于 beta.2 及后续版本。完成完整备份后：

1. 打开 **管理后台 → 系统信息 → 系统更新**。
2. 点击 **检查更新**。公共版只查询 `zhoujasper/phd-atlas`，浏览器不能传入
   任意下载 URL。
3. 检查 Release 页面、版本、发布时间和包大小，再点击 **安装 vX**。
4. 等待进程重启，重新登录并验证版本、`/api/health`、日志和一次代表性读写。

下载严格使用 HTTPS，并限制允许主机、重定向、时间和 100 MiB 大小。服务器
要求恰好一组匹配的更新包与 checksum 资产，流式计算并验证外部 SHA-256，
检查内部版本和 manifest，验证每个受管理文件，并在安排重启前拒绝未管理或
未声明文件。

自动下载更新包的时间预算是 15 分钟。自动和手动 Admin 请求的浏览器预算都是
30 分钟，因为服务器会先完成校验和更新前完整工作空间备份。每一层反向代理都应
设为 60 分钟，避免代理早于浏览器断开。

GitHub 不可用时，可在另一台可信设备下载两个 Release 资产并验证 `.sha256`，
再展开 **手动更新** 上传 `.tar.gz`。手动和自动流程使用同一套内部校验和安装
助手。

助手把旧运行时代码保存在 `storage/update-rollbacks/`，只替换受管理的运行时
文件，执行 `npm ci --omit=dev`，并在安装失败时尝试恢复旧运行时。结果和诊断
记录在 `storage/last-update-result.json`、`storage/update-helper.log`，回滚
不完整时还会写入 `storage/.update-runtime-invalid.json`。它有意不替换
`.env`、已选数据库、上传和备份。

交接前，助手会检查每个受管理 JavaScript 文件的语法，并对服务器与启动器执行
import 预检。通过后，候选版本默认仍要经过 30 秒首次启动试运行；持续运行到该
时间窗口结束才会确认。若候选版本提前失败或异常退出，项目提供的启动器会恢复
上一按内容寻址的激活包或回滚快照并重试。恢复失败时会写入
`storage/.update-runtime-invalid.json`，并阻止再次启动应用 worker。排障时应
保留 `storage/.update-boot-pending.json` 和其他更新标记，不能通过删除它们
强行启动部分更新的运行时。主动停止服务或容器时会释放试运行 claim，下一次
启动会继续试运行候选版本，不会把正常部署停机误判成首次启动失败。

原生部署由 systemd/WinSW 在 worker 有意以 75 退出后重启服务。Docker 中
`tools/container-entrypoint.mjs` 作为 PID 1 的受管进程继续运行，等待助手锁
解除后重新启动服务器 worker；整个流程不需要 Docker socket。必须另行保留
完整工作空间备份，并在每次更新后检查服务健康；助手的回滚目录不能替代运维
备份。

## 验收检查

部署完成前应逐项验证：

- 公网 HTTPS 的 `/api/health` 成功，健康 WebSocket 以 101 完成升级；
- 全新安装显示 `/admin` 的四个初始化步骤，完成后该路由变为普通管理员登录；
- 已选数据库通过连接测试，并在服务或容器重启后保持数据；
- 普通账户和管理员登录；
- 在申请深链接中硬刷新；
- 新建、编辑、删除、上传、下载和 JSON/CSV/Excel/PDF 导出；
- 可以创建完整工作空间备份，并实际测试过恢复；
- PWA manifest 和 Service Worker 通过 HTTPS 加载；
- 已配置的 SMTP、Web Push 和 AI 集成分别通过测试。

参考官方文档：
[Node.js 版本状态](https://nodejs.org/en/about/previous-releases)、
[Docker Compose 生产指南](https://docs.docker.com/compose/how-tos/production/)、
[Nginx 代理模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、
[Microsoft IIS ARR 反向代理](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/reverse-proxy-with-url-rewrite-v2-and-application-request-routing)
和 [WinSW](https://github.com/winsw/winsw)。
