# PhD Atlas

[English](README.md) | [简体中文](README.zh-CN.md)

> 一套可自托管、隐私优先的博士申请全流程管理工作空间。

[![CI](https://github.com/zhoujasper/phd-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/zhoujasper/phd-atlas/actions/workflows/ci.yml)
[![状态：Beta](https://img.shields.io/badge/status-beta-f59e0b.svg)](TODO.zh-CN.md)
[![许可证：MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 24 LTS](https://img.shields.io/badge/Node.js-24%20LTS-339933.svg)](https://nodejs.org/)

> [!WARNING]
> **PhD Atlas 当前是 Beta。** 在第一个稳定公共版之前，
> 数据库结构、已存数据和升级路径可能发生不向后兼容的变化。重要数据必须备份，
> Beta 更新应先在副本中测试。当前预发布版本与已发布安装包以
> [Releases 页面](https://github.com/zhoujasper/phd-atlas/releases)为准。

PhD Atlas 把申请项目、潜在导师、材料、截止日期、通信、奖学金、可复用个人资料、
导出和备份集中到一个安静高效的工作空间中。它面向自托管设计：默认 SQLite，
也可选择 MySQL/MariaDB、PostgreSQL 或 Microsoft SQL Server；上传文件、备份、
凭据和集成设置都保留在你控制的基础设施上。

本仓库是**公共单工作空间版本**。团队与机构协作功能不会随公共版分发，
公共安装包也不包含任何团队启用资料。待权限、数据迁移和移动端工作流达到
公开使用标准后，才会通过[路线图](TODO.zh-CN.md)公布后续安排。

## 功能总览

### 申请指挥中心

- 新建、编辑、复制、归档、恢复和永久删除申请记录。
- 跟踪大学、项目、院系、国家、申请门户、潜在导师、实验室、研究契合度、
  截止日期、状态、优先级和进度。
- 即时搜索，并按状态、国家、标签、截止日期和其他申请字段筛选。
- 在高密度列表与看板之间切换；每个申请和档案页签都有稳定的深链接。
- 通过交互式仪表盘查看状态分布、临近截止日期、最近活动、重点申请和下一步行动。
- 使用桌面式键盘操作、右键菜单和多选批量管理记录。

### 发现和比较项目

- 记录研究兴趣、目标地区、学历背景、资助需求和其他检索条件。
- 浏览并排序项目与 PI 目录。
- 调整匹配因素权重，比较生活成本调整后的奖学金，隐藏或关注候选项，并保存决策笔记。
- 把发现结果直接导入申请工作空间，同时带入学校、导师、研究、资助和时间线信息。

### 完整申请档案

- 维护中英文学校和导师资料、联系方式、主页、实验室、研究方向和契合度说明。
- 使用结构化清单管理 CV、成绩单、推荐信、个人陈述、研究计划、语言成绩、
  门户注册、SOP 和最终提交。
- 配置推荐信数量和推荐人联系信息。
- 为材料项目添加提醒、状态、分组和详细说明。
- 上传和下载文件，保留版本历史和便于回滚的元数据。
- 跟踪奖学金和资助时间窗口。
- 管理带截止日期的任务，提供平滑完成动画和统一申请事件时间线。
- 检查费用、提交就绪状态和申请级整体进度。

### 通信与邮件

- 以对话时间线记录收发邮件、聊天/消息、会议、门户活动和私人笔记。
- 撰写导师邮件，支持附件和可选 AI 草稿。
- 连接 IMAP 做严格范围的邮箱采集：只处理你申请记录中导师地址相关的邮件。
- 按文件夹游标导入收发历史并防止重复。
- 配置 SMTP 发信，并为相关事件发送站内/邮件通知。

### 个人资料库

- 集中保存可复用的 CV、成绩单、陈述、研究计划、证书和写作素材。
- 创建带本地化名称、描述、图标、颜色和内容的个人预设。
- 将个人资料插入或复制到申请中，避免反复录入。
- 创建受控上传链接来收集文件，无需分享整个工作空间。

### 分享、导出和日历

- 创建可过期、可撤销、按栏目控制权限的分享链接。
- 将申请数据导出为 JSON、CSV、Excel 和排版完善的 PDF。
- 生成日历订阅以及截止日期/任务提醒。
- 接收浏览器通知和可选 Web Push。
- 使用带已读状态和去重机制的统一通知中心。

### 备份与管理

- 创建和恢复单个申请备份及整个工作空间的系统备份。
- 管理保留策略并检查存储占用。
- 在 `/admin` 管理注册、账户、配额、会话、系统事件、邮件设置、加密策略和更新包。
- 新部署首次打开 `/admin` 时，通过一次性引导创建首位管理员，选择并验证
  SQLite、MySQL/MariaDB、PostgreSQL 或 SQL Server，再配置 SMTP；连接验证
  成功后初始化入口永久关闭。
- 后续可从 **管理后台 → 系统配置 → 数据库连接** 测试并迁移当前工作空间。
- 在 Admin 检查公开 GitHub Releases 并安装可用更新；也可展开手动备用入口，
  上传可信 Release 包。项目提供的 Docker、systemd 和 WinSW 启动器共用同一
  受保护更新助手。
- 使用请求 ID、速率限制、Zod 校验、Helmet 安全头、Host/Origin 白名单
  和隐私安全审计事件。
- 对保存的集成密钥加密；管理设置中还提供可选 SQLite 密封和加密控制。

### 可安装、响应式和无障碍

- 在兼容的 Chrome/Edge 中把 PhD Atlas 安装为 PWA。
- 离线打开缓存的工作空间快照，并将支持的个人修改排队，在恢复连接后进行冲突感知重放。
- 使用桌面、平板和手机布局：四栏桌面工作区、紧凑平板组合和移动端底部导航。
- 选择浅色/深色模式、强调色、高对比度和减少动态效果。
- 使用支持键盘的自定义日期和下拉选择控件。
- 支持英语、简体中文、德语、西班牙语、法语、意大利语、日语、韩语、
  葡萄牙语、俄语、泰语和越南语。

## 公共版边界

公共构建使用确定性的版本标记来：

- 移除团队导航和工作空间切换；
- 拒绝团队 API 路由；
- 移除团队邀请处理和团队套餐展示；
- 使用空白登录字段，不提供私有演示快捷方式。

团队协作将在权限、数据迁移和移动端交互模型达到公开使用标准后进入公共版。

## 技术栈

- React 19 + TypeScript 6 + Vite 8
- Express 5
- 通过 `better-sqlite3` 使用 SQLite，并可选择 MySQL/MariaDB、PostgreSQL
  或 Microsoft SQL Server 作为持久数据源
- Zod 数据契约
- Vitest + Testing Library + Playwright
- 基于设计变量的原生 CSS，不使用 CSS 框架

生产环境由同一个 Node.js 进程提供前端和 API。持久运维文件保存在 `storage/`；
已选数据库保存持久工作空间快照。

## 快速开始

要求：64 位 Node.js 24 LTS 和 Git。

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
npm ci
npm run dev
```

打开 `http://localhost:5173/admin`。新数据库会显示一次性设置引导，要求填写：

- 首位管理员姓名、登录邮箱和至少 12 位的密码；
- SQLite 或外部 MySQL/MariaDB、PostgreSQL、SQL Server 连接；
- 系统 SMTP 主机、端口、登录名、应用密码、TLS 选项和通知收件人。

PhD Atlas 会在保存前验证数据库和 SMTP 连接。管理员创建成功后，设置 API 永久
关闭，`/admin` 以后只显示正常登录页。公共版不附带默认密码。

首次安装、数据库权限与迁移安全、日常使用、备份和排障的逐步说明见
[INSTALLATION.zh-CN.md](INSTALLATION.zh-CN.md)。

## 生产部署

Docker 是最短的支持路径：

```bash
cp .env.example .env
# 设置 HTTPS 网址和两个独立密钥；公共构建会忽略 BOOTSTRAP_*。
docker compose pull
docker compose up -d --wait
```

Compose 只绑定 `127.0.0.1:4317`，并把全部应用数据保存在命名卷中。
请在前面配置 HTTPS 反向代理。

Docker、Ubuntu、通用 Linux、CentOS Stream/RHEL 兼容系统和
Windows Server + IIS 的完整步骤见[中文部署指南](DEPLOYMENT.zh-CN.md)。

## 配置

生产环境必须设置：

- 面向公网 HTTPS 域名的 `BASE_URL`、`CORS_ORIGIN` 和 `ALLOWED_HOSTS`；
- 反向代理与程序在同一台主机时使用 `TRUST_PROXY=loopback`；
- 分别生成随机 `JWT_SECRET` 和 `SETTINGS_ENCRYPTION_KEY`，不得复用。

服务启动后，首次打开 `https://你的域名/admin` 创建管理员、选择数据库并配置
系统发件邮箱。
可选变量包括 VAPID Web Push 密钥和 PDF 字体；完整清单见
[.env.example](.env.example)。

## 常用命令

```bash
npm run dev          # Express + Vite 开发服务器
npm run dev:web      # 仅 Vite，/api 代理到 :4317
npm run dev:api      # 仅 Express
npm run build        # TypeScript + 生产前端 + Service Worker 标记
npm run build:update-package # 构建 Admin 可接收的 .tar.gz 更新包
npm start            # 提供 API 和 dist；存在 .env 时自动加载
npm run lint         # oxlint
npm run i18n:check   # 检查语言包完整性和 UI 硬编码文本
npm test             # Vitest 单元/集成测试
npm run test:e2e     # Playwright 端到端测试
```

## 数据和备份安全

不要提交或随意删除 `storage/`，其中包含：

- `phd-atlas.sqlite` 及 WAL/SHM 文件；
- `database-connection.json`；外部数据库密码由
  `SETTINGS_ENCRYPTION_KEY` 加密；
- 上传材料和消息附件；
- 申请备份和系统备份；
- 生成的更新包和持久化集成资料。

升级前先创建系统内备份，在进程停止时复制整个 `storage/` 目录或 Docker 卷；
若使用外部数据库，同时创建匹配的数据库快照。SQLite 使用 WAL 时不能只复制主
`.sqlite` 文件。外部数据库也不能替代这个卷：上传、备份、密码字段加密的连接
信息和兼容缓存仍保存在其中；跨服务器还必须保留原
`SETTINGS_ENCRYPTION_KEY`。

## Release 与后台更新

每个 `vMAJOR.MINOR.PATCH` 或符合 SemVer 的预发布标签都会运行公共 Release 工作流。
它会验证源代码、构建生产前端、为每个受管理运行时文件生成 SHA-256 清单，
实际测试安装和回滚，再把 `.tar.gz` 与校验文件附加到 GitHub Release。
带标签的更新包和容器在发布前还必须通过隔离的 Microsoft SQL Server 2022
adapter 冒烟测试。

Beta 更新包执行同样的运行时代码安装和回滚测试，但不承诺不同 Beta 版本之间的
数据库结构或已存数据兼容。每次 Beta 更新前必须备份整个工作空间。

已经运行 `v0.1.0-beta.2` 或更高版本的 Docker、Windows 原生或 Linux 原生部署：

1. 在 Admin 创建完整工作空间备份，并备份停止状态的 `storage/`。
2. 打开 **管理后台 → 系统信息 → 系统更新**，点击 **检查更新**，检查公开
   Release 后点击 **安装 vX**。
3. 服务器无法连接 GitHub 时，展开 **手动更新**；在可信设备下载 `.tar.gz`
   和 `.sha256`、验证 checksum，再上传更新包。
4. 等待服务重启，重新登录并确认版本、健康状态和一次代表性读写。

已经发布的 `v0.1.0-beta.1` 早于这套受保护更新流程。Docker 用户必须先固定或
选择已经发布的 beta.2 镜像，再运行 `docker compose pull` 和
`docker compose up -d --wait`。原生 beta.1 部署**不能**通过旧 Admin 卡片上传
beta.2：原 systemd 沙箱既无法让助手存活，也不允许它替换运行时。应执行
[部署指南中的一次性停服引导](DEPLOYMENT.zh-CN.md#原生-beta1-到-beta2-一次性引导)，
全程只使用已校验的 beta.2 Release 包。完成引导后，才能使用 Admin 自动或手动
更新。

更新器不会替换 `.env`、已选数据库、上传文件或备份。Docker 还会把验证后的
激活 Release 包持久化到 `storage/`，因此从较旧基础镜像重建容器时可以重新
应用。信任边界、备份、首次启动和回滚细节见
[安装指南](INSTALLATION.zh-CN.md)和[部署指南](DEPLOYMENT.zh-CN.md)。

## 项目结构

```text
src/                 React 应用、类型化 API 客户端、i18n 和样式
server/              Express 路由、多数据库持久层、邮件、推送、AI 和导出
public/              PWA 清单、图标、Service Worker 和启动资源
tests/e2e/            Playwright 用户流程测试
deploy/               systemd、Nginx、WinSW 和 IIS 模板
tools/                构建、验证、压力测试和启动工具
Dockerfile            可复现生产镜像
compose.yaml          单机生产 Compose 服务
INSTALLATION.zh-CN.md 首次安装、数据库选择、使用和排障
DEPLOYMENT.md         英文多平台部署指南
DEPLOYMENT.zh-CN.md   中文多平台部署指南
```

## 路线图和贡献

公共路线图见 [TODO.zh-CN.md](TODO.zh-CN.md)。欢迎提交 Issue 和聚焦明确的 PR。
提交前请运行：

```bash
npm run lint
npm run i18n:check
npx tsc --noEmit
npm test
npm run build
```

## 许可证

[MIT](LICENSE)
