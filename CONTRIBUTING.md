# 贡献指南

感谢你对 PhD Atlas 的关注。本文档介绍开发环境设置、代码规范、测试要求和 PR 流程。

> 提交贡献即表示你同意按 [PhD Atlas Community License v1.0](LICENSE) 提供该贡献。
> 本项目是带商业使用限制的源码可见项目，并非 MIT 或 OSI 认可的开源项目；任何营利
> 机构、企业或商业组织在使用本项目之前仍须取得版权所有者的书面授权。

---

## 开发环境设置

### 前置要求

- Node.js 24 LTS
- Git 2.x
- 代码编辑器（推荐 VS Code）

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas

# 安装依赖
npm ci

# 启动开发服务器（同时运行前端和 API）
npm run dev
```

开发服务器启动后：
- 前端: `http://localhost:5173`
- API: `http://localhost:4317`

### 测试账户

| 用途 | 邮箱 | 密码 |
| --- | --- | --- |
| 普通工作区 | `jasper@example.com` | `demo123456` |
| 管理后台 | `admin@phd-atlas.local` | `admin123456` |

---

## 代码规范

### TypeScript / JavaScript

- **类型安全**：前端使用 TypeScript，服务端使用 JSDoc 类型注释
- **命名约定**：
  - 组件：PascalCase (`DossierView.tsx`)
  - 函数/变量：camelCase (`getUserById`)
  - 常量：UPPER_SNAKE_CASE (`MAX_UPLOAD_SIZE`)
  - 文件名：kebab-case 或 PascalCase

- **风格指南**：
  ```typescript
  // ✅ 好的示例
  interface Application {
    id: string
    title: string
    status: ApplicationStatus
  }

  async function saveApplication(app: Application): Promise<void> {
    await api.updateApplication(app.id, app)
  }

  // ❌ 避免
  const data: any = await fetch('/api/data')  // 不使用 any
  function process(x) { return x + 1 }        // 缺少类型
  ```

### React 组件

- **函数组件**优于类组件
- 使用 **Hooks** 管理状态和副作用
- 保持组件单一职责
- 提取可复用逻辑到自定义 Hooks

```tsx
// ✅ 好的组件结构
interface ApplicationRowProps {
  application: Application
  onSelect: (id: string) => void
}

export function ApplicationRow({ application, onSelect }: ApplicationRowProps) {
  const handleClick = () => onSelect(application.id)

  return (
    <div className="application-row" onClick={handleClick}>
      <h3>{application.title}</h3>
      <span className="status">{application.status}</span>
    </div>
  )
}
```

### CSS

- 遵循 Apple 风格的简约设计（见 `docs/UI_DESIGN_SPEC.md`）
- 使用设计令牌（定义在 `src/index.css`）
- 避免内联样式，优先使用 CSS 类
- 响应式设计：移动优先

```css
/* ✅ 使用设计令牌 */
.button-primary {
  background: var(--color-primary);
  border-radius: var(--radius-default);
  padding: var(--spacing-2) var(--spacing-4);
}

/* ❌ 避免硬编码值 */
.button {
  background: #007AFF;
  border-radius: 8px;
  padding: 8px 16px;
}
```

### 国际化 (i18n)

- **所有用户可见文本必须国际化**
- 不要硬编码显示文本
- 使用命名空间组织翻译

```tsx
// ✅ 使用 i18n
const { t } = useTranslation('dossier')
<button>{t('save')}</button>

// ❌ 硬编码文本
<button>保存</button>
```

添加新翻译：
1. 在 `src/i18n/en/<namespace>.json` 添加英文
2. 在 `src/i18n/zh/<namespace>.json` 添加中文
3. 运行 `npm run i18n:check` 验证

---

## 提交规范

### Commit Message 格式

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**类型 (type)**：
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具链

**范围 (scope)** 示例：
- `dossier`, `profile`, `dashboard`, `api`, `storage`, `i18n`, `ui`

**示例**：
```bash
feat(dossier): add material version history

- Display upload date and file size
- Add download button for each version
- Sort by upload time descending

Closes #123
```

### 分支策略

- `main` — 稳定主分支，受保护
- `feature/<name>` — 新功能开发
- `fix/<name>` — Bug 修复
- `refactor/<name>` — 重构

```bash
# 创建功能分支
git checkout -b feature/add-timeline-export

# 开发并提交
git add .
git commit -m "feat(timeline): add PDF export option"

# 推送分支
git push origin feature/add-timeline-export
```

---

## 测试要求

### 运行测试

```bash
# 单元测试和集成测试
npm test

# E2E 测试
npm run test:e2e

# 类型检查
npm run typecheck

# 代码检查
npm run lint

# i18n 完整性检查
npm run i18n:check

# 完整验证（CI 标准）
npm run verify:tree
```

### 测试覆盖率

- 新功能必须包含测试
- 关键路径覆盖率 > 80%
- Bug 修复应添加回归测试

### 测试示例

```typescript
// 单元测试
import { describe, it, expect } from 'vitest'
import { formatDeadline } from './dateUtils'

describe('formatDeadline', () => {
  it('should format ISO date to readable string', () => {
    const result = formatDeadline('2026-09-01T00:00:00Z')
    expect(result).toBe('September 1, 2026')
  })
})

// 组件测试
import { render, screen } from '@testing-library/react'
import { ApplicationRow } from './ApplicationRow'

it('renders application title', () => {
  const app = { id: '1', title: 'MIT PhD' }
  render(<ApplicationRow application={app} onSelect={() => {}} />)
  expect(screen.getByText('MIT PhD')).toBeInTheDocument()
})
```

---

## Pull Request 流程

### 1. 创建 PR

1. Fork 仓库（外部贡献者）或创建功能分支（团队成员）
2. 完成开发和测试
3. 推送代码并创建 Pull Request
4. 填写 PR 模板

### 2. PR 描述模板

```markdown
## 变更说明
简要描述此 PR 的目的和实现方式。

## 变更类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 重构
- [ ] 文档更新
- [ ] 性能优化

## 测试
- [ ] 单元测试通过
- [ ] E2E 测试通过
- [ ] 手动测试完成

## 截图（UI 变更）
如有 UI 变更，附上前后对比截图。

## 相关 Issue
Closes #issue-number
```

### 3. Code Review 标准

审查者会检查：
- ✅ 代码质量和可读性
- ✅ 测试覆盖率
- ✅ 性能影响
- ✅ 安全性
- ✅ i18n 完整性
- ✅ 文档更新

### 4. 合并要求

- 所有 CI 检查通过
- 至少一位 maintainer 批准
- 无未解决的 review 意见
- 分支与 main 同步

```bash
# 同步 main 分支
git checkout main
git pull origin main
git checkout feature/my-feature
git rebase main

# 解决冲突后推送
git push --force-with-lease
```

---

## 开发最佳实践

### 1. 并发控制

- 使用租户级写锁，避免全局锁
- 参考 `docs/CONCURRENCY.md`

```javascript
// ✅ 使用租户锁
await withWriteLock(async () => {
  // 修改用户数据
}, { tenantKeys: [`user:${userId}`] })

// ❌ 避免全局锁
await withWriteLock(async () => {
  // ...
})
```

### 2. 错误处理

- 所有异步操作需要错误处理
- 向用户显示友好的错误消息

```typescript
try {
  await api.saveApplication(app)
  showToast('保存成功', 'success')
} catch (error) {
  console.error('Save failed:', error)
  showToast('保存失败，请重试', 'error')
}
```

### 3. 性能优化

- 避免不必要的重渲染
- 使用 `useMemo` 和 `useCallback`
- 大列表使用虚拟滚动
- 懒加载非关键模块

```tsx
// ✅ 优化渲染
const filteredApps = useMemo(
  () => applications.filter(app => app.status === selectedStatus),
  [applications, selectedStatus]
)

// ❌ 每次渲染都重新过滤
const filteredApps = applications.filter(app => app.status === selectedStatus)
```

### 4. 安全实践

- 永远不要在客户端存储敏感信息
- 所有 API 输入需要验证
- 使用参数化查询防止 SQL 注入
- 文件上传需要类型和大小限制

---

## 项目结构

```
phd-atlas/
├── server/                # 后端代码
│   ├── index.js          # Express 服务器
│   ├── storage.js        # 数据存储
│   ├── validation.js     # Zod schemas
│   └── routes/           # API 路由（重构中）
├── src/                  # 前端代码
│   ├── App.tsx           # 应用入口
│   ├── api/              # API 客户端
│   ├── components/       # React 组件
│   │   ├── screens/      # 页面级组件
│   │   └── shared/       # 共享组件
│   ├── data/             # 数据模型
│   ├── i18n/             # 国际化资源
│   └── styles/           # CSS 样式
├── shared/               # 前后端共享
├── tools/                # 构建工具
├── docs/                 # 文档
└── tests/                # E2E 测试
```

---

## 常见任务

### 添加新的 API 端点

1. 在 `server/index.js` 或 `server/routes/` 添加路由
2. 在 `server/validation.js` 添加 Zod schema
3. 在 `src/api/phdApi.ts` 添加客户端方法
4. 添加测试
5. 更新 `docs/API_CONTRACTS.md`

### 添加新的 UI 组件

1. 在 `src/components/` 创建组件文件
2. 遵循设计规范（`docs/UI_DESIGN_SPEC.md`）
3. 添加 i18n 支持
4. 添加组件测试
5. 在 Storybook 中展示（如适用）

### 添加新语言

参考 `docs/I18N_LANGUAGE_PACKS.md`：
1. 复制 `src/i18n/en/` 到 `src/i18n/<lang-code>/`
2. 翻译所有 JSON 文件
3. 在 `src/i18n.ts` 注册语言
4. 运行 `npm run i18n:check`

---

## 发布流程

**仅限 maintainers**

1. 更新 `package.json` 版本号
2. 更新 `CHANGELOG.md`
3. 运行完整验证：
   ```bash
   npm run verify:release
   ```
4. 提交并打标签：
   ```bash
   git commit -am "chore: release v0.1.0-beta.9"
   git tag v0.1.0-beta.9
   git push origin main --tags
   ```
5. GitHub Actions 自动构建和发布

---

## 获取帮助

- **文档**：查看 `docs/` 目录
- **Issue**：在 GitHub 提交问题
- **讨论**：GitHub Discussions

---

## 行为准则

- 尊重所有贡献者
- 提供建设性反馈
- 专注于技术讨论
- 保持专业和包容

感谢你的贡献！
