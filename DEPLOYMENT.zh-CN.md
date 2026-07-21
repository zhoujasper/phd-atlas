# 部署 PhD Atlas

[English](DEPLOYMENT.md) | [简体中文](DEPLOYMENT.zh-CN.md)

PhD Atlas 由一个 Node.js 进程运行：Express 同时提供 `/api` 和构建后的 React 应用。
SQLite、上传文件、备份、更新包和自动生成的推送密钥都位于 `storage/`。
任何升级都必须保留这个目录。

> [!WARNING]
> 当前版本是 Beta。运行时更新包会经过完整性校验和回滚测试，但不同 Beta 版本之间
> 不保证数据库结构和已存数据兼容。每次部署或更新 Beta 前都要创建并验证完整工作空间备份。
> 稳定兼容保证从第一个稳定公共版开始。

## 生产环境要求

- 64 位 Node.js 24 LTS。Vite 8 技术上接受 Node `^20.19.0` 或 `>=22.12.0`，
  但生产环境推荐 Node 24 LTS。
- 为 `storage/` 提供持久本地磁盘。不要把活动 SQLite 数据库放在 NFS、SMB
  或其他网络文件系统上。
- 在反向代理处提供 HTTPS。生产服务器会把普通 HTTP 重定向到 HTTPS。
- 小型个人部署至少准备 1 GB 内存；`npm ci` 和 `npm run build` 时应保留更多内存。

## 配置

把 `.env.example` 复制为 `.env`，替换全部 `replace-with-...` 值并填写真实公网 URL：

```bash
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

为 `JWT_SECRET` 和 `SETTINGS_ENCRYPTION_KEY` 分别生成不同随机值。
`.env` 已被 Git 忽略。公共版不提供默认账户：首次启动后打开
`https://你的域名/admin`，完成一次性管理员和 SMTP 设置。
服务器会先验证 SMTP 连接，再提交管理员，并永久关闭初始化路由。

私有源版本仍支持 `.env.example` 中的 `BOOTSTRAP_*` 种子值；公共版会忽略它们。

## Docker（推荐）

每次成功推送到 `main` 后，GitHub Actions 会把多架构（`linux/amd64` 和
`linux/arm64`）镜像发布到
[`ghcr.io/zhoujasper/phd-atlas-source`](https://github.com/zhoujasper/phd-atlas-source/pkgs/container/phd-atlas-source)。
安装带 Compose 的 Docker Engine 或 Docker Desktop，然后运行：

```bash
cp .env.example .env
# 继续前先编辑 .env。
docker compose pull
docker compose up -d --wait
docker compose ps
docker compose logs -f phd-atlas
```

如果镜像包仍是私有的，首次拉取前请使用有包读取权限的 GitHub 账户登录：

```bash
docker login ghcr.io
```

`compose.yaml` 默认使用 `ghcr.io/zhoujasper/phd-atlas-source:beta`；这明确是
Beta 通道，不代表稳定版。可通过
`PHD_ATLAS_IMAGE=ghcr.io/zhoujasper/phd-atlas-source:1.2.3-beta.1` 固定到经过
测试的 Beta 版本，或使用包页面展示的不可变 `sha-...` 标签。若要测试本地源码构建的镜像：

```bash
docker build -t phd-atlas:local .
PHD_ATLAS_IMAGE=phd-atlas:local docker compose up -d --wait
```

Compose 只把程序绑定到 `127.0.0.1:4317`；请在前面使用 Nginx、Caddy、IIS、
Traefik 或带 HTTPS 的隧道。修改宿主机端口：

```bash
APP_PORT=8080 docker compose up -d --wait
```

命名卷 `phd-atlas-data` 会在容器重建时保留 SQLite 和上传文件。升级时不要删除卷：

```bash
docker compose pull
docker compose up -d --wait
```

备份卷：

```bash
docker run --rm \
  -v phd-atlas_phd-atlas-data:/data:ro \
  -v "$PWD:/backup" \
  alpine tar -czf /backup/phd-atlas-storage.tgz -C /data .
```

除非确实要删除全部应用数据，否则绝不能运行 `docker compose down -v`。

## Ubuntu Server

以下命令适用于 Ubuntu 22.04/24.04 或更新版本。

1. 安装 Node.js 24 LTS、Git、编译工具和 Nginx。NodeSource 安装脚本是一种常用方式：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential python3 nginx
node --version
```

确认版本为 v24 后继续。

2. 创建服务账户并安装程序：

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

3. 安装并启动随项目提供的 systemd 单元：

```bash
sudo cp /opt/phd-atlas/deploy/linux/phd-atlas.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now phd-atlas
sudo systemctl status phd-atlas
curl -H 'Host: phd.example.com' -H 'X-Forwarded-Proto: https' http://127.0.0.1:4317/api/health
```

4. 把 `deploy/nginx/phd-atlas.conf` 复制到 `/etc/nginx/sites-available/`，
替换 `phd.example.com` 和证书路径，启用站点，运行 `sudo nginx -t` 后重新加载 Nginx。
对外开放服务前必须取得有效证书。

## CentOS Stream / RHEL 兼容 Linux

使用 CentOS Stream 9/10 或仍受支持的 RHEL 兼容发行版。
不要在新的互联网服务上使用已停止支持的 CentOS Linux 7。

1. 安装 Node.js 24 LTS 和原生编译工具。例如使用 NodeSource RPM 仓库：

```bash
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs git gcc-c++ make python3 nginx
node --version
```

2. 按 Ubuntu 部分完成服务账户、克隆、`npm ci`、构建、环境变量和 systemd 步骤。
   RHEL 系统的 Nginx 文件通常放在 `/etc/nginx/conf.d/phd-atlas.conf`。
3. 配置证书后只开放 HTTPS：

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

通过发行版支持的软件包安装 Node.js 24 LTS、Git、Python 3、`make`、C++ 编译器
和反向代理。使用 systemd 的发行版可以直接采用项目提供的 unit。
固定部署顺序为：

```bash
npm ci
npm run build
npm prune --omit=dev
NODE_ENV=production node tools/start-server.mjs
```

必须使用专用非特权账户运行、持久化 `storage/`、加载生产环境变量，
并把 HTTPS 反向代理到 `127.0.0.1:4317`。

## Windows Server

支持的原生结构为 Node.js 24 LTS + WinSW + 带 ARR 和 URL Rewrite 的 IIS。

1. 安装 64 位 Node.js 24 LTS、Git、IIS、URL Rewrite 2 和
   Application Request Routing（ARR）。
2. 克隆到 `C:\PhDAtlas`，在管理员 PowerShell 中构建：

```powershell
git clone https://github.com/zhoujasper/phd-atlas.git C:\PhDAtlas
Set-Location C:\PhDAtlas
Copy-Item .env.example .env
notepad .env
npm ci
npm run build
npm prune --omit=dev
```

3. 从 WinSW 官方 GitHub Release 下载当前稳定可执行文件，保存为
   `C:\PhDAtlas\PhDAtlas.exe`，再把
   `deploy\windows\PhDAtlas.xml.example` 复制为
   `C:\PhDAtlas\PhDAtlas.xml`。服务包装器会通过
   `tools\start-server.mjs` 继承项目 `.env`。
4. 安装并验证服务：

```powershell
Set-Location C:\PhDAtlas
.\PhDAtlas.exe install
.\PhDAtlas.exe start
.\PhDAtlas.exe status
```

5. 在 IIS ARR 中启用代理并保留原 Host Header。把 `HTTP_X_FORWARDED_PROTO`
   加入允许的服务器变量，将 `deploy\windows\web.config.example` 复制到 IIS
   站点的 `web.config`，绑定有效 HTTPS 证书，并把站点物理目录指向只包含该文件的
   小型代理目录。

```powershell
& $env:windir\System32\inetsrv\appcmd.exe set config `
  /section:system.webServer/proxy /enabled:true /preserveHostHeader:true
```

在 `.env` 中把 `BASE_URL`、`CORS_ORIGIN` 和 `ALLOWED_HOSTS` 设置为 IIS HTTPS
域名，并设置 `TRUST_PROXY=loopback`。通过公网 HTTPS 测试 `/api/health`，
然后测试登录、上传/下载、导出和服务器重启。

## 升级与回滚

每次升级前，在应用中创建系统备份，并在进程停止时复制整个 `storage/`。
然后执行：

```bash
git pull --ff-only
npm ci
npm run build
npm prune --omit=dev
sudo systemctl restart phd-atlas
```

回滚时停止服务，同时恢复上一代码版本和与其匹配的 `storage/` 快照，再启动服务。
SQLite WAL 文件属于数据库状态，必须复制整个存储目录，不能只复制 `.sqlite`。

Beta 版本之间没有数据库或已存数据兼容承诺，因此仅回滚运行时代码可能不足以恢复。
Beta 回滚必须使用更新前的完整 `storage/` 快照。

## 验收检查

```bash
curl -fsS https://phd.example.com/api/health
```

随后验证：

- 新部署显示一次性 `/admin` 设置；完成后刷新只显示管理员登录；
- 普通账户和管理员登录；
- 在 `/applications/...` 等深链接中硬刷新；
- 新建/编辑/删除以及重启后的持久化；
- 文件上传/下载和 JSON/CSV/Excel/PDF 导出；
- 备份创建和恢复；
- HTTPS 下的 PWA 清单和 Service Worker；
- 已启用时测试邮件、Web Push 和 AI 集成。

## 更新已有原生部署

带标签的公共 Release 会附带 `phd-atlas-update-*.tar.gz` 和对应 SHA-256 文件。
先创建完整工作空间备份，从 GitHub Release 下载更新包，然后在
**管理后台 → 系统信息 → 系统更新** 中上传。

服务器会在计划更新前校验包清单和每个文件哈希。服务退出后，独立更新器会把旧运行时代码
保存在 `storage/update-rollbacks/`，只替换受管理的运行时文件，执行
`npm ci --omit=dev` 并解除启动锁。安装失败时，会在服务再次启动前恢复旧运行时代码。
原生部署必须通过随项目提供的 systemd 或 WinSW 模板使用 `npm start`，
这样重启和更新锁才能正常工作。

运行时代码回滚不等于 Beta 数据兼容。更新器有意不替换 `.env`、SQLite、上传和备份，
因此 Beta 数据库变更仍必须依靠管理员创建的完整备份恢复。

Docker 部署不要在容器内使用 Admin 更新：拉取/构建新镜像并运行
`docker compose up -d --build --wait`，持久 `storage/` 卷会继续挂载。

参考官方文档：[Node.js 版本状态](https://nodejs.org/en/about/previous-releases)、
[Docker Compose 生产指南](https://docs.docker.com/compose/how-tos/production/)、
[Nginx 代理模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、
[Microsoft IIS ARR 反向代理](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/reverse-proxy-with-url-rewrite-v2-and-application-request-routing)
和 [WinSW](https://github.com/winsw/winsw)。
