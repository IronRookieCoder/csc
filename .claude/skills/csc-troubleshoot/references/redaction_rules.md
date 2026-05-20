# 脱敏规则参考

`sanitize.py` 的脱敏规则详细规范。

## 优先级

1. 字段名规则（先于值模式规则）
2. 值模式规则
3. 通用熵检测（最后防线）

## 字段名规则

字段名（忽略大小写和 `-`/`_` 差异）包含以下子串时，值被脱敏：

- `key`
- `token`
- `secret`
- `password`
- `passwd`
- `credential`
- `authorization`
- `cookie`
- `session_token`
- `session_secret`
- `session_cookie`
- `private`
- `cert`
- `env`（仅当值是对象/dict 时，遍历其内部值逐个脱敏）

### 白名单（绝不按字段名脱敏）

- `session_id`, `uuid`, `pid`, `id`, `parentUuid`, `sessionId`
- `slug`, `name`, `display`, `kind`, `status`, `type`, `agentType`
- `entrypoint`, `project`, `cwd`, `version`, `peerProtocol`
- `gitBranch`, `gateway`, `baseUrl`, `url`, `endpoint`, `host`
- `path`, `file_path`, `source`, `mtime`, `bytes`, `sha256`
- `generated_at`, `schema_version`, `time_from`, `time_to`

### 安全值判定

如果字段名敏感但值匹配以下模式，**不脱敏**（避免误杀普通标识符）：

```
/^(true|false|null|none|undefined|\d+\.?\d*|[a-zA-Z_][\w.]*)$/i
```

例如：`{"type": "key"}` 中 `type` 值为 `"key"` 是普通字符串，但如果 `{"apiKey": "sk-ant-..."}`，字段名 `apiKey` 匹配 `key` 且值不是简单标识符 → 脱敏。

## 值模式规则

无论字段名如何，只要值匹配以下模式就脱敏：

### API Key 前缀
- `sk-...` (OpenAI)
- `sk-ant-...` / `sk-ant-api-...` (Anthropic)
- `xoxb-...` / `xoxp-...` / `xoxa-...` / `xoxs-...` (Slack)
- `ghp_...` (GitHub classic)
- `github_pat_...` (GitHub fine-grained)

### Bearer Token
- `Bearer <20+ chars>`

### JWT
- 三段 `.` 分隔的 base64url 字符串，第一段以 `eyJ` 开头

### 私钥
- `-----BEGIN {RSA,EC,OPENSSH,DSA} PRIVATE KEY-----` 至 `-----END` 的完整块

### URL 凭证
- `https://user:pass@host` → `https://[REDACTED]:[REDACTED]@host`

### 邮箱
- `user@domain.com` → `user_<4-char-hash>@domain.com`

### Home 目录
- `/Users/demo/...` → `~/...`
- `C:\Users\demo\...` → `~\...`

## 脱敏输出格式

| 场景 | 输出 |
|------|------|
| 短值（≤8 字符） | `[REDACTED]` |
| API key / token | `sk-a...9xyz`（前4后4，`...` 分隔） |
| 多行密钥 | `[REDACTED_MULTILINE_SECRET]` |
| 用户名/主机名 | 稳定 SHA256 前8位 hex 哈希 |
| 邮箱本地部分 | `user_` + 前4位哈希 |

## env 对象特殊处理

当字段名为 `env`/`environment`/`envVars`/`env_vars` 时，**遍历其所有值**，逐个作为字符串脱敏（不依赖字段名规则，因为 env 对象的 key 是变量名，值可能含密钥）。

```json
{"env": {"ANTHROPIC_API_KEY": "sk-ant-..."}}
→
{"env": {"ANTHROPIC_API_KEY": "sk-a...9xyz"}}
```

## 不脱敏的内容

以下内容明确保留原始值（对排障有诊断价值且不敏感）：

- 版本号（`1.2.3`、`v2.1.126`）
- 文件路径（除 home 目录）
- 命令名和标志
- UUID
- 时间戳
- 计数器和数值
- 域名（不含凭证的 URL）
