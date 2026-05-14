---
title: "用户操作手册"
description: "从安装到上手使用 CoStrict (csc) 的完整指南"
keywords: ["用户手册", "安装", "配置", "快速上手", "csc", "CoStrict"]
---

# CoStrict（CSC） 用户操作手册

本手册覆盖从安装到日常使用的完整流程，帮助你快速上手 CoStrict（命令名 `csc`）。

---

## 目录

1. [环境准备](#1-环境准备)
2. [安装](#2-安装)
3. [首次启动与认证](#3-首次启动与认证)
4. [基本使用](#4-基本使用)
5. [常用斜杠命令](#5-常用斜杠命令)
6. [权限模式](#6-权限模式)
7. [多 API 协议切换](#7-多-api-协议切换)
8. [MCP 扩展](#8-mcp-扩展)
9. [Feature Flag 控制](#9-feature-flag-控制)
10. [配置文件说明](#10-配置文件说明)
11. [常用场景示例](#11-常用场景示例)
12. [故障排查](#12-故障排查)

---

## 1. 环境准备

### 运行时要求

| 项目 | 要求 |
|------|------|
| **运行时** | [Bun](https://bun.sh/) >= 1.2.0 |
| **操作系统** | macOS / Windows / Linux |
| **网络** | 需要访问 AI API 端点 |

### 安装 Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
irm bun.sh/install.ps1 | iex

# 验证安装
bun --version
```

---

## 2. 安装

### 从 npm 全局安装

```bash
npm install -g @costrict/csc --registry=https://registry.npmjs.org/
```

安装后即可使用 `csc` 命令。

---

## 3. 首次启动与认证

### 启动 REPL

```bash
csc
```

首次启动会进入交互式终端界面（REPL）。

### 认证方式

在 REPL 中输入 `/login`，选择认证方式：

#### 方式一：CoStrict 企业登录（推荐）

适用于企业用户，通过 SSO 自动完成：

```
/login → 选择 CoStrict → 浏览器 SSO 登录 → 自动完成
```

- 认证服务：`https://zgsm.sangfor.com/oidc-auth`
- 凭证存储：`~/.claude/csc-auth.json`（0600 权限）
- 自动刷新：三层 Token 验证 + 预防性刷新 + 401 响应式恢复

#### 方式二：第三方 API 直连

适用于个人用户或自建 API 服务。选择 **Anthropic Compatible / OpenAI / Gemini**，填写以下信息：

| 字段 | 说明 | 示例 |
|------|------|------|
| Base URL | API 服务地址 | `https://api.example.com/v1` |
| API Key | 认证密钥 | `sk-xxx` |
| Haiku Model | 快速模型 | `claude-haiku-4-5-20251001` |
| Sonnet Model | 平衡模型 | `claude-sonnet-4-6` |
| Opus Model | 高性能模型 | `claude-opus-4-6` |

#### 直接编辑配置文件

跳过交互式登录，直接编辑 `~/.claude/settings.json`：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.example.com/v1",
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5-20251001",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-6",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-6"
  }
}
```

---

## 4. 基本使用

### 交互式对话

启动后进入 REPL 界面，直接输入问题或指令即可：

```
> 帮我写一个 TypeScript 的快速排序函数
> 解释一下 src/utils/auth.ts 的逻辑
> 修复 README 中的拼写错误
```

CoStrict 会自动：
- 读取项目代码
- 修改文件
- 执行 Shell 命令
- 搜索文件和代码
- 创建子 Agent 处理复杂任务

### Headless / Pipe 模式

不进入交互界面，直接获取输出：

```bash
# 单次提问
echo "列出 src/ 下的所有 TypeScript 文件" | csc -p

# 从文件输入
cat question.txt | csc -p

# 带上下文目录
csc -p "检查这个项目的依赖安全性" --cwd /path/to/project
```

### 指定模型

```
> /model  # 开始切换模型
```

---

## 5. 常用斜杠命令

在 REPL 中输入 `/` 开头的命令执行快捷操作。以下是核心命令清单：

### 会话与导航

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/clear` | 清除当前对话 |
| `/compact` | 压缩对话上下文，释放 Token 空间 |
| `/resume` | 恢复上一次会话 |
| `/cost` | 查看当前会话的 Token 消耗 |
| `/status` | 查看当前状态 |
| `/exit` | 退出 REPL |

### 模型与模式

| 命令 | 说明 |
|------|------|
| `/model` | 切换或查看模型 |
| `/fast` | 切换快速模式（同模型更快输出） |
| `/plan` | 进入计划模式（只规划不执行） |
| `/permissions` | 管理权限设置 |
| `/effort` | 调整推理努力程度 |

### 项目与文件

| 命令 | 说明 |
|------|------|
| `/add-dir` | 添加额外工作目录 |
| `/files` | 查看文件上下文 |
| `/diff` | 查看代码变更 |
| `/branch` | 切换 Git 分支 |
| `/commit` | 生成 Git 提交 |

### 认证与配置

| 命令 | 说明 |
|------|------|
| `/login` | 重新登录 / 切换认证方式 |
| `/logout` | 登出当前账户 |
| `/config` | 查看和修改配置 |
| `/doctor` | 诊断运行环境问题 |
| `/provider` | 查看或切换 API 提供商 |

### 记忆与上下文

| 命令 | 说明 |
|------|------|
| `/memory` | 管理项目记忆文件 |
| `/context` | 查看当前上下文信息 |

### 高级功能

| 命令 | 说明 |
|------|------|
| `/mcp` | MCP 服务管理 |
| `/review` | 代码审查 |
| `/security-review` | 安全审计 |
| `/skills` | 技能管理 |
| `/agents` | 查看可用 Agent |
| `/tasks` | 任务管理 |
| `/theme` | 切换主题 |
| `/vim` | 切换 Vim 键绑定 |
| `/keybindings` | 自定义快捷键 |
| `/stats` | 查看统计信息 |
| `/upgrade` | 检查更新 |

### MCP 工具命令

MCP 服务的工具可以通过特殊语法调用：

```
/mcp:工具名 (MCP) 参数
```

---

## 6. 权限模式

CoStrict 提供 5 种权限模式，控制 AI 对工具的自动执行权限：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **default** | 危险操作需确认 | 日常开发（推荐） |
| **acceptEdits** | 自动允许文件编辑，Shell 需确认 | 频繁编辑代码 |
| **dontAsk** | 大部分操作自动执行 | 信任项目环境 |
| **plan** | 只规划不执行 | 方案设计阶段 |
| **bypassPermissions** | 跳过所有权限检查（危险） | CI/自动化流水线 |

### 权限规则

可以针对特定工具设置允许/拒绝规则，在 `settings.json` 中配置：

```json
{
  "permissions": {
    "allow": [
      "Bash(git status)",
      "Bash(npm test)",
      "FileRead"
    ],
    "deny": [
      "Bash(rm -rf *)"
    ]
  }
}
```

---
## 7. MCP 扩展

MCP（Model Context Protocol）允许扩展 CoStrict 的能力，接入外部工具和数据源。

### 基本操作

```bash
# 启动 MCP 服务器
csc mcp serve

# 添加 MCP 服务
csc mcp add <name> <command>

# 以 JSON 配置添加
csc mcp add-json <name> '<json-config>'

# 从 Claude Desktop 导入配置
csc mcp add-from-claude-desktop

# 列出已配置的服务
csc mcp list

# 查看服务详情
csc mcp get <name>

# 移除服务
csc mcp remove <name>

# 重置项目级 MCP 选择
csc mcp reset-project-choices
```

### 在 REPL 中管理

```
> /mcp
```

---

## 8. 配置文件说明

CoStrict 使用 Claude 默认配置目录体系，不会生成独立配置目录。

### 配置文件位置

| 文件 | 位置 | 用途 |
|------|------|------|
| 用户全局配置 | `~/.claude/settings.json` | 全局设置、环境变量、权限 |
| 项目配置 | `.claude/settings.json` | 项目级设置 |
| 认证凭证 | `~/.claude/csc-auth.json` | CoStrict 企业认证 Token |
| 项目记忆 | `~/.claude/projects/<project>/memory/` | 跨会话持久化记忆 |
| CLAUDE.md | 项目根目录 | 项目级 AI 指令 |

### settings.json 结构示例

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.example.com/v1",
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5-20251001",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-6",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-6"
  },
  "permissions": {
    "defaultMode": "default",
    "allow": ["Bash(git *)", "FileRead", "Glob", "Grep"],
    "deny": ["Bash(rm -rf *)"]
  }
}
```

---

## 9. 常用场景示例

### 场景 1：快速修复 Bug

```
> 文件 src/utils/auth.ts 第 42 行有 null 指针异常，帮我修复
```

CoStrict 会自动读取文件、定位问题、生成修复代码。

### 场景 2：代码审查

```
> /review
```

或指定范围：

```
> 审查 src/api/ 目录下最近修改的文件，关注安全问题
```

### 场景 3：安全审计

```
> /strict-security-review
```
---

## 10. 故障排查

### 常见问题

#### Q: 启动后版本号显示异常

```bash
bun run dev    # 正常应显示 888
bun run build  # 构建后运行 dist/cli.js
```

#### Q: 认证失败 / Token 过期

```
> /login
```

重新登录即可。CoStrict 企业认证会自动刷新 Token。

#### Q: 环境诊断

```
> /doctor
```

自动检测运行环境、依赖、认证状态等。

#### Q: API 连接超时

1. 检查网络连通性
2. 确认 `ANTHROPIC_BASE_URL` 或对应协议的 Base URL 配置正确
3. 检查 API Key 是否有效
4. 尝试 `/provider` 查看当前提供商状态

#### Q: 上下文空间不足

```
> /compact
```

压缩当前对话，释放 Token 空间。

#### Q: 输出乱码 / 主题问题

```
> /theme
> /color
```

切换主题或颜色配置。

#### Q: 排查 raw dump 上报数据

开启**本地留存模式**，让 raw dump 数据只写入本地文件而不上报服务端，用于调试和排障：

```bash
# 在启动 csc 前设置环境变量
export CSC_RAW_DUMP_LOCAL_MODE=1
export CSC_RAW_DUMP_LOCAL_DIR=/tmp/raw-dump-debug

csc
```

留存文件按 `sessionID` 分目录存储：

```
/tmp/raw-dump-debug/
└── {sessionID}/
    ├── 2026-05-12T10-30-00-conversation-msg-uuid.json
    ├── 2026-05-12T10-30-01-summary-msg-uuid.json
    └── 2026-05-12T10-30-02-commit-abc123.json
```

每个 JSON 文件包含完整的上报 payload，并在 `_dumpMeta` 字段标注类型和时间戳。本地模式特点：

- **无需登录** — auth 失败自动降级，不会阻断流程
- **不触发 HTTP** — 零网络依赖，零 429 风险
- **与正常流程一致** — 队列 + worker 机制完全保留，只是输出到本地文件

关闭本地模式（恢复正常上报）：

```bash
unset CSC_RAW_DUMP_LOCAL_MODE
```

---