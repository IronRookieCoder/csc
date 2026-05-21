# 代理 / CA 证书问题修复验证指南

## 背景

修复了两个导致 csc 无法启动的环境变量问题：

1. **`https_proxy` 不可达** — 当 `https_proxy` 指向未运行的代理时，csc 会在 TCP 连接超时处卡死
2. **`NODE_EXTRA_CA_CERTS` 路径无效** — 当证书文件不存在或为目录时，TLS 握手阶段卡死，Ctrl+C 无法终止

修复策略：在 `init()` 阶段提前校验并清除无效的环境变量，避免后续网络层卡死。

---

## 构建 csc

### 方式 1：开发模式（DEV）

直接运行源码，无需构建，适合快速迭代。

```bash
# 安装依赖
bun install

# dev 模式运行（MACRO defines + feature flags 由 scripts/dev.ts 注入）
bun run dev -- --help
```

**原理**：`scripts/dev.ts` 通过 Bun `-d` flag 注入 MACRO 常量、`--feature` flag 启用功能开关，直接执行 `src/entrypoints/cli.tsx`。

**注意**：dev 模式会在启动时尝试下载 review builtin 资源（`scripts/generate-review-builtin.ts`），如果网络不可达会输出警告但不影响继续运行。

### 方式 2：构建产物（BUILD）

构建出可在 Node.js 下运行的独立产物。

```bash
# 安装依赖
bun install

# 构建
bun run build
```

构建过程（`build.ts`）：
1. 清空 `dist/` 目录
2. 生成 review builtin 文件（非致命）
3. `Bun.build()` 打包，入口 `src/entrypoints/cli.tsx`，开启 code splitting
4. 后处理：`import.meta.require` → Node.js 兼容写法
5. 后处理：`feature('FLAG_NAME')` → 内联替换为 `true`/`false`
6. 后处理：`globalThis.Bun` 解构 → 安全 fallback
7. 复制 ripgrep 等 native 资源到 `dist/vendor/`
8. 生成入口文件：`dist/cli-bun.js`、`dist/cli-node.js`

产物结构：

```
dist/
├── cli.js          # 主 bundle
├── cli-bun.js      # Bun shebang 入口  (#!/usr/bin/env bun)
├── cli-node.js     # Node shebang 入口 (#!/usr/bin/env node)
├── chunk-*.js      # code splitting 分片
└── vendor/         # ripgrep、audio-capture 等二进制
```

运行构建产物：

```bash
# 用 Node.js 运行
node dist/cli-node.js --help

# 用 Bun 运行
bun dist/cli-bun.js --help

# 或者直接运行 cli.js
node dist/cli.js --help
bun dist/cli.js --help
```

### 关键区别

| 项目 | DEV 模式 | BUILD 模式 |
|------|---------|-----------|
| 入口 | `src/entrypoints/cli.tsx` | `dist/cli.js` |
| 启动脚本 | `scripts/dev.ts` | `dist/cli-node.js` |
| feature flags | `--feature` CLI 参数 | 编译时内联替换 |
| MACRO defines | `-d` 编译参数 | `Bun.build({ define })` |
| 适用场景 | 开发调试 | 生产/测试 |
| 启动速度 | 较慢（动态解析） | 快（预编译） |

---

## 测试步骤

### 测试 1：不可达的 https_proxy

模拟本地代理未启动的场景。

```bash
# === DEV 模式 ===
https_proxy=http://127.0.0.1:19999 bun run dev -- --help

# === BUILD 模式 ===
# 先构建
bun run build
# 再测试
https_proxy=http://127.0.0.1:19999 node dist/cli-node.js --help
```

**预期结果**：
- 正常输出帮助信息，不卡死
- 修复前：TCP 连接尝试到达不可达代理，卡死
- 修复后：500ms TCP 可达性探测失败 → 自动清除 `https_proxy` → 直连

**验证清除**：

```bash
export https_proxy=http://127.0.0.1:19999
bun run dev -- --help
echo $https_proxy
# 输出应为空 — 不可达代理已被自动清除
```

---

### 测试 2：无效的 NODE_EXTRA_CA_CERTS

设置一个不存在的证书文件。

```bash
# === DEV 模式 ===
NODE_EXTRA_CA_CERTS=/tmp/nonexistent-cert.pem bun run dev -- --help

# === BUILD 模式 ===
NODE_EXTRA_CA_CERTS=/tmp/nonexistent-cert.pem node dist/cli-node.js --help
```

**预期结果**：
- 正常输出帮助信息，不卡死
- 修复前：TLS 模块初始化时尝试读取不存在的证书文件 → 永久卡死
- 修复后：`init()` 中提前校验文件存在性 → 自动清除 `NODE_EXTRA_CA_CERTS`

**验证清除**：

```bash
export NODE_EXTRA_CA_CERTS=/tmp/nonexistent-cert.pem
bun run dev -- --help
echo $NODE_EXTRA_CA_CERTS
# 输出应为空 — 无效路径已被自动清除
```

---

### 测试 3：目录路径（边界情况）

```bash
NODE_EXTRA_CA_CERTS=/tmp bun run dev -- --help
echo $NODE_EXTRA_CA_CERTS
# 输出应为空 — 目录也会被清除
```

---

### 测试 4：组合测试

两个问题变量同时存在。

```bash
export https_proxy=http://127.0.0.1:19999
export NODE_EXTRA_CA_CERTS=/tmp/nonexistent.pem

# DEV 模式
bun run dev -- --help

# BUILD 模式
node dist/cli-node.js --help

echo $https_proxy
echo $NODE_EXTRA_CA_CERTS
# 两个都应为空
```

---

### 测试 5：正常代理（回归验证）

验证可达代理不会被误清除。

```bash
# 在另一个终端启动一个简单的 TCP 监听（模拟代理）
# 方式1：用 netcat 监听 8888 端口
nc -l 8888 &
# 方式2：用 Python 启动简单 HTTP 服务器
python3 -m http.server 8888 &

# 设置代理指向可达端口
export https_proxy=http://127.0.0.1:8888

bun run dev -- --help

echo $https_proxy
# 应保留 http://127.0.0.1:8888（代理可达，不会被清除）

# 清理
kill %1
unset https_proxy
```

---

### 测试 6：有效的 NODE_EXTRA_CA_CERTS（回归验证）

验证有效的证书文件不会被误清除。

```bash
# 创建一个自签名证书用于测试
openssl req -x509 -newkey rsa:2048 -keyout /tmp/test-key.pem \
  -out /tmp/test-cert.pem -days 1 -nodes -subj "/CN=test"

export NODE_EXTRA_CA_CERTS=/tmp/test-cert.pem

bun run dev -- --help

echo $NODE_EXTRA_CA_CERTS
# 应保留 /tmp/test-cert.pem（有效文件，不会被清除）

# 清理
unset NODE_EXTRA_CA_CERTS
rm /tmp/test-cert.pem /tmp/test-key.pem
```

---

## 运行单元测试

```bash
# 仅运行代理和 CA 证书相关测试
bun test src/utils/__tests__/caCerts.test.ts src/utils/__tests__/proxy.test.ts

# 运行全部测试
bun test

# 检查类型
bunx tsc --noEmit
```

---

## 修复原理简述

### caCerts.ts

- `validateExtraCACertsEnv()` — 启动早期调用，校验文件存在性 + 是否为普通文件
- `readExtraCACert()` — 读取证书前先 `statSync` 检查，无效则调用 `clearInvalidExtraCACertsEnv()` 清除
- `clearInvalidExtraCACertsEnv()` — 仅在值匹配时 `delete process.env.NODE_EXTRA_CA_CERTS`，避免误删其他来源的设置

### proxy.ts

- `isValidProxyUrl()` — 校验 URL 格式（必须有 hostname、protocol 为 http/https）
- `ensureProxyReachabilityCheck()` — 对 loopback 代理做 500ms TCP 探测
- `isLoopbackProxyUrl()` — 判断是否为本地回环地址（localhost / 127.x / ::1）
- `clearMatchingProxyEnv()` — 清除所有匹配的代理变量（`https_proxy` / `HTTPS_PROXY` / `http_proxy` / `HTTP_PROXY`）
