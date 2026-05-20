# 经验沉淀模板

每次排障完成后，将诊断过程、根因和修复方案按以下格式沉淀为可复用知识条目。

## 存储位置

```
~/.claude/troubleshoot-knowledge/
├── index.json              # 知识条目索引
├── entries/
│   ├── k-<8char>.md        # 每个条目一个 Markdown 文件
│   └── ...
```

## YAML 模板

```yaml
# === 排障知识条目 ===

id: "k-<8-char-hex>"
timestamp: "<ISO 8601>"           # 如 2026-05-19T14:30:00+08:00
severity: "P0 | P1 | P2 | P3"    # P0=阻塞, P1=主流程异常, P2=功能受限, P3=体验问题
csc_version: "x.y.z"             # 出问题的 CSC 版本

# --- 症状 ---
symptom:
  type: "hang | hook_failure | permission | api_error | session_lost | startup_crash | plugin | tool_error | general"
  description: "用户/测试人员对问题的原始描述（脱敏）"
  os: "win | mac | linux"

# --- 诊断路径 ---
diagnostic_path:
  entries_found: true | false          # 是否在已有知识库中找到匹配条目
  matched_entry_id: "k-xxxxxxxx"       # 匹配到则填写，否则 null
  new_observations:                    # 本案例新增的诊断发现
    - layer: 1-10
      checks_performed: ["check1", "check2"]
      hypotheses:
        - hypothesis: "假设描述"
          result: "confirmed | ruled_out | inconclusive"
          evidence: "引用具体日志行号/JSONL 片段/配置内容（脱敏）"

# --- 根因 ---
root_cause:
  layer: 1-10
  category: "config | network | auth | mcp | hooks | permission | model | file | env | code | unknown"
  summary: "一句话根因"
  detail: "详细根因分析（含脱敏后的关键证据片段）"
  is_new_pattern: true | false         # 是否为未被已有知识库覆盖的新模式

# --- 修复 ---
fix:
  steps:
    - order: 1
      action: "具体修复操作"
      risk: "low | medium | high"
      reversible: true | false
  outcome: "resolved | partial | failed"

# --- 验证 ---
verification:
  method: "验证方式描述"
  result: "resolved | partial_resolved | unresolved"

# --- 元信息 ---
tags: ["tag1", "tag2"]                # 用于搜索的关键标签
related_symptoms: ["hook_failure"]
preventative:
  - "预防建议 1"

# --- 知识库更新建议 ---
knowledge_update:
  should_update_repair_patterns: true | false
  should_update_layered_diagnosis: true | false
  suggested_changes: "对 repair_patterns.md 或 layered_diagnosis.md 的修改建议"
```

## index.json 结构

```json
{
  "version": "1.0",
  "updated_at": "2026-05-19T14:30:00+08:00",
  "total_entries": 42,
  "entries": [
    {
      "id": "k-abc12345",
      "timestamp": "2026-05-19T10:30:00+08:00",
      "symptom_type": "hook_failure",
      "category": "config",
      "severity": "P2",
      "summary": "Hook matcher 大小写不匹配导致工具事件不触发",
      "tags": ["hooks", "bash", "matcher", "case-sensitive"],
      "outcome": "resolved",
      "file": "entries/k-abc12345.md"
    }
  ]
}
```

## 条目生命周期

1. **创建**：排障完成后由 Phase 4 生成
2. **验证**：后续排障中若匹配到已有条目，记录匹配结果，验证条目有效性
3. **更新**：若出现新的变化（如新版本引入新原因），更新条目并追加 `diagnostic_path.new_observations`
4. **淘汰**：若条目对应的修复模式已通过代码修复（不再需要手动干预），标记为 deprecated
