# Worktree 高效验证指南

## 核心思路

每个 Git worktree 拥有独立的文件系统副本，可以并行执行验证任务，同时共享同一个 `.git` 仓库。利用这个特性实现隔离、并行的改动验证。

## 1. 并行验证策略

各 worktree 之间互不干扰，可以同时执行不同的验证任务：

- **Worktree A** — 跑全量测试：`bun run precheck`
- **Worktree B** — 跑构建验证：`bun run build && node dist/cli.js -p "say hello"`
- **Worktree C** — 跑类型检查：`bunx tsc --noEmit`

它们各自有独立的工作目录，同时运行不会有文件冲突。

## 2. 针对性验证 — 按范围缩小

不需要每次都跑全量（2992 tests / 188 files），按改动范围选择：

```bash
# 只跑某个模块的测试
bun test src/utils/__tests__/hash.test.ts

# 按目录跑
bun test src/services/

# 按文件名模式匹配
bun test -t "feature name"
```

类型检查建议用增量模式加速：

```bash
bunx tsc --noEmit --incremental
```

## 3. 关键验证命令速查

| 验证维度 | 命令 | 说明 |
|---------|------|------|
| 类型检查 | `bunx tsc --noEmit` | 项目使用 strict 模式，必须零错误 |
| 测试 | `bun test` | Bun 原生测试，速度快 |
| Lint + Format | `bun run check:fix` | Biome 自动修复 |
| 构建 | `bun run build` | 输出到 `dist/cli.js` |
| 全量门禁 | `bun run precheck` | typecheck + lint fix + test 三位一体 |

## 4. 依赖安装注意事项

新创建的 worktree 需要独立安装依赖（`node_modules` 在各自的 worktree 目录下）：

```bash
cd ../csc-fix-xxx
bun install
```

多个 worktree 可以并行 `bun install`，互不阻塞。

## 5. 推荐工作流

```bash
# 1. 创建 worktree
git worktree add ../csc-fix-xxx -b fix/xxx

# 2. 安装依赖
cd ../csc-fix-xxx
bun install

# 3. 修改代码后逐级验证
bun run check:fix          # 先过 lint + format（最快）
bunx tsc --noEmit          # 再过类型检查
bun test                   # 跑测试
bun run precheck           # 最终全量门禁（提交前必过）
```

## 6. 多 Worktree 并行验证示意

```
主 worktree (main)          worktree A (feat/x)       worktree B (fix/y)
     │                           │                        │
     ├─ bun install              ├─ bun install           ├─ bun install
     ├─ 改代码                    ├─ 改代码                 ├─ 改代码
     ├─ bun run check:fix        ├─ bun test              ├─ bunx tsc --noEmit
     ├─ bunx tsc --noEmit        ├─ bun run precheck      ├─ bun run build
     ├─ bun test                 │                        │
     └─ bun run precheck         └─ 提交                   └─ 提交
```

所有 worktree 的验证命令可以**同时并行执行**，完全隔离，互不影响。
