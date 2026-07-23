# 更新日志

[English](CHANGELOG.md)

PhD Atlas 公开版的所有重要变化都记录在此文件中。格式遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0-beta.2] - 2026-07-23

**预发布版本 — Beta。** 在首个稳定版发布前，数据库结构、已存数据和升级路径
仍可能发生不向后兼容的变化。安装或更新前，请先创建完整工作空间备份，在应用
停止后复制整个 `storage/` 目录或 Docker 卷；如果使用外部数据库，还应同时创建
该数据库的匹配快照。

### 新增

- 新增服务器首次使用时的一次性 `/admin` 配置流程。管理员可以选择 SQLite、
  MySQL/MariaDB、PostgreSQL 或 Microsoft SQL Server，测试连接，并且只能在
  合适的空目标上完成首次配置。
- 新增 Admin 中后续测试数据库连接和迁移工作空间的控制项；外部数据库密码会
  加密保存。
- 新增公开 Docker 镜像 `ghcr.io/zhoujasper/phd-atlas`，包括滚动更新的 `beta`
  通道和固定版本的预发布标签。Beta 发布工作流同时构建 `linux/amd64` 与
  `linux/arm64`，并且有意不发布 `latest` 标签。
- 新增 Admin 自动更新检查，更新源固定为公开的
  `zhoujasper/phd-atlas` GitHub Releases。发现兼容的新版本后，管理员可以先
  查看 Release 页面，再一键安装。
- 新增手动上传 Release 更新包的备用入口，适用于离线或网络受限的服务器。
  Docker、systemd 和 WinSW 部署共用同一套已验证安装包和受控重启流程。
- 新增 Docker 持久更新重放：已验证并激活的 Release 包保存在
  `storage/active-update/`；即使容器由较旧基础镜像重建，也会重新应用该包，
  全程不需要访问 Docker socket。

### 变更

- Release 更新现在会先创建完整工作空间备份，保留 `.env`、已选数据库、上传
  文件和已有备份，并且只替换受管理的运行时代码。
- Docker 与原生启动器现在会协调更新锁，在安装后重启应用 worker，启动时确认
  候选运行时；若启动验证失败，则恢复上一套运行时和之前的激活包指针。
- 公开 Release 自动化现在会构建名称确定的
  `phd-atlas-update-<version>-release.tar.gz` 及配套 `.sha256` 文件，测试安装
  与回滚流程，并将验证后的资产附加到 GitHub 预发布版本。
- 多架构容器冒烟测试现在会在 `linux/amd64` 与 `linux/arm64` 之间清理
  Docker 本地的多架构清单缓存，确保两个变体都被独立拉取和运行验证后，才会
  提升任何公开标签。标签提升后的 GHCR 匿名摘要检查也会进行有界重试，避免
  注册表传播延迟造成发布误报失败。

### 安全

- Release 检查只接受规范的 SemVer 标签，以及固定公开仓库中唯一且符合预期的
  安装包与校验文件组合。
- 更新包内容指纹现在采用与区域设置无关的归档路径排序，因此同一个确定性安装包
  可以在 Windows 与 Linux 上得到一致的验证结果。
- Release 下载仅允许 HTTPS，并限制重定向次数、时间和大小；激活前会校验
  SHA-256、包清单、声明版本、文件集合、解压路径、条目类型和解压上限。
- 中断或未完成的更新会安全失败；诊断标记和日志会保留，回滚不完整时则阻止
  部分更新的运行时继续启动。

### 文档

- 新增详细的英文和简体中文安装指南，覆盖 Docker、首次 Admin 配置、四类
  数据库选择、日常使用、备份、更新和故障排查。
- 扩充部署指南，覆盖 Docker Compose、Ubuntu 与通用 Linux、CentOS
  Stream/RHEL 兼容系统、Windows WinSW、反向代理、TLS/私有 CA、持久存储、
  数据库迁移和 Beta 回滚。
- 更新公开版 README，补充受支持数据库矩阵、公开 GHCR 镜像与标签策略、手动
  与自动 Release 更新路径，以及现有 `0.1.0-beta.1` 安装的一次性升级说明。

[0.1.0-beta.2]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.2
