# 今后如何发布 Team 版本

[English](TEAM_ENABLEMENT.md) | [简体中文](TEAM_ENABLEMENT.zh-CN.md)

公共仓库当前有意只发布个人/自托管版本。Team 和机构功能在准备公开期间，仍以私有源仓库为唯一事实来源。

不要手工把个别 Team 文件复制到公共仓库。这样很容易遗漏导航、API 授权、数据库迁移、
语言包或测试。Team 必须作为一次完整、经过审查的版本边界变更，由私有源仓库的导出器统一发布。

## 上线门槛

公开启用 Team 之前，必须在私有源仓库完成以下全部工作：

1. 完成所有者、教师、学生、邀请、重新分配、移除、审计恢复和配额行为。
2. 对每条 Team API 路由执行权限测试，包括跨 Team 和未登录请求。
3. 测试现有个人 SQLite 数据库升级到支持 Team 的版本，并测试回滚到上一版本。
4. 在 320、400、820 和 1400 px 下测试完整 Team 界面，同时覆盖键盘导航、
   减少动态效果、深色模式、空 Team 和大型 Team。
5. 更新公共 README、数据模型说明、部署指南和 Release Notes，
   让管理员了解新角色和备份影响。

## 修改私有源仓库

只在 `zhoujasper/phd-atlas-source` 中开发，不要直接修改自动生成的公共镜像。

1. 新建分支，例如 `public-team`。
2. 将公共版的布尔边界改成显式功能配置，例如 `TEAM_ENABLED=true`。
3. 从 `tools/export-public.mjs` 的排除列表中移除 Team 文件、样式、测试和语言文件。
4. 删除 `writePublicEditionFiles()` 生成的 Team 兼容占位文件。
5. 同时启用 Team 导航、邀请路由、套餐展示、工作空间启动字段和 Team API；
   不允许只开放 UI 或只开放 API。
6. 增加数据库迁移版本和降级/回滚测试。公共版本绝不能依赖私有演示 Team 的种子数据。
7. 导出到全新目录，并确认其中没有 `AGENTS.md`、`PROJECT_MEMORY.md`、`.public/`
   或私有 `docs/` 目录。

## 验证和发布

运行：

```bash
npm ci
npm run lint
npm run i18n:check
npx tsc --noEmit
npm test
npm run build
node tools/export-public.mjs ../phd-atlas-public-check
cd ../phd-atlas-public-check
npm ci
npm run i18n:check
npx tsc --noEmit
npm test
npm run build
```

审查完成后，把源分支合并到 `main`。私有仓库的 `Sync public edition` 工作流会导出、
验证并推送公共树。不要用手工修改的公共 PR 覆盖自动生成文件。

发布 Beta 版本：

```bash
git tag v0.2.0-beta.1
git push origin v0.2.0-beta.1
```

标签会被镜像到公共仓库。公共 Release 工作流会构建可由
**管理后台 → 系统信息 → 系统更新** 接收的同格式更新包，验证包内容和运行时代码回滚，
再把 `.tar.gz` 与 SHA-256 校验文件添加到 GitHub Release。

## Beta 数据兼容边界

当前 Beta 阶段不承诺数据库结构、迁移路径或已存数据在不同 Beta 版本之间兼容。
Team 涉及数据库结构的变更必须先在副本上测试，并在每次尝试前建立完整工作空间备份。
正式的数据兼容和迁移承诺从第一个稳定公共版开始。

## 紧急回滚

如果 Team 版本未通过生产冒烟检查，应停止发布、在私有源仓库修复并发布更高的补丁版本。
原生部署可上传上一个兼容 Release 包；更新器也会在 `storage/update-rollbacks/`
保留本地运行时代码回滚。涉及数据库结构的版本必须始终另行保留完整工作空间备份。
