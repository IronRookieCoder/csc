# CSC 二进制编译指南

CSC 使用**两阶段构建**生成独立二进制文件。

## 第一阶段：打包（`bun run build`）

将 TypeScript 源码打包为单个 JS 文件：

```bash
bun run build
```

这一步执行 `build.ts`，产出 `dist/cli.js`（主入口）+ 若干 chunk 文件 + vendor 二进制（ripgrep、audio-capture）。同时还会：

- 将 `import.meta.require` 替换为 Node.js 兼容写法
- 内联 feature flag（`feature('X')` → `true`/`false`）
- 生成 `dist/cli-bun.js` 和 `dist/cli-node.js` 两个可执行入口（带 shebang）

## 第二阶段：编译二进制（`bun run compile:*`）

基于 `dist/cli.js`，用 Bun 的 `--compile` 功能生成各平台独立可执行文件：

| 命令 | 目标平台 | 产物 |
|------|---------|------|
| `bun run compile:linux` | Linux x64 | `dist/csc-linux-x64` |
| `bun run compile:linux-baseline` | Linux x64 (旧 CPU 兼容) | `dist/csc-linux-x64-baseline` |
| `bun run compile:linux-musl` | Linux x64 musl (Alpine) | `dist/csc-linux-x64-musl` |
| `bun run compile:linux-musl-baseline` | Linux x64 musl baseline | `dist/csc-linux-x64-musl-baseline` |
| `bun run compile:win` | Windows x64 | `dist/csc-windows-x64.exe` |
| `bun run compile:win-baseline` | Windows x64 baseline | `dist/csc-windows-x64-baseline.exe` |
| `bun run compile:mac-arm64` | macOS Apple Silicon | `dist/csc-darwin-arm64` |
| `bun run compile:mac-x64` | macOS Intel | `dist/csc-darwin-x64` |
| `bun run compile:mac-x64-baseline` | macOS Intel baseline | `dist/csc-darwin-x64-baseline` |

## 便捷组合命令

```bash
# 单平台一键构建（build + compile）
bun run build:binary:linux        # Linux x64
bun run build:binary:mac-arm64    # macOS ARM64
bun run build:binary:mac          # macOS ARM64 + x64
bun run build:binary:win          # Windows x64

# 全平台构建（耗时较长）
bun run build:binary:all
```

## 原理

底层就是 `bun build --compile`，例如 macOS ARM64：

```bash
bun build dist/cli.js --compile --target=bun-darwin-arm64 --outfile dist/csc-darwin-arm64
```

`--compile` 会将 JS 代码和 Bun 运行时一起打包成单个独立二进制文件，目标机器无需安装 Bun 或 Node.js 即可直接运行。`baseline` 变体针对较老的 CPU 架构（不含 AVX2 等新指令集），兼容性更好但性能略低。

## 注意事项

- 必须在 macOS 上编译 macOS 二进制，在 Linux 上编译 Linux 二进制（**不支持交叉编译**）
- `build.ts` 中的 `sourcemap: 'linked'` 生成的 `.map` 文件在构建末尾会被删除（节省约 64MB）
- 产物中已嵌入 ripgrep 和 audio-capture 等 native 依赖的二进制文件
