# Tasks 工具异常排查与修复总结

## 问题概述

用户在会话 `5a8e4642-6f9b-4196-8b12-1fc7ce36f3be` 中测试任务列表功能：

1. 创建一个任务。
2. 将任务状态更新为进行中。
3. 将任务状态更新为完成。

实际表现为：

- `TaskCreate` 能成功创建任务 `Task #1`。
- 后续大量 `TaskUpdate` 调用失败，错误为缺少必填参数 `taskId`。
- 模型多次在自然语言中表示“将提供 taskId/status”，但实际工具调用输入仍是 `{}`。
- 其中一次 `TaskUpdate` 只传入 `{"taskId":"1"}`，工具返回成功，但 `updatedFields: []`，任务状态实际没有变化。
- 连续失败后 CoStrict 返回 `429 status code`。

## 关键证据

原始会话文件：

- `bug/5a8e4642-6f9b-4196-8b12-1fc7ce36f3be/5a8e4642-6f9b-4196-8b12-1fc7ce36f3be.jsonl`

排障信息包：

- `bug/cc-debug-bundle-20260515-112502`

关键记录：

- `TaskCreate` 成功：`Task #1 created successfully: 测试任务列表更新功能`
- 多次 `TaskUpdate` 工具调用记录为 `input: {}`
- 校验错误：

```text
InputValidationError: TaskUpdate failed due to the following issue:
The required parameter `taskId` is missing
```

- 第一次非空 `TaskUpdate` 输入为：

```json
{"taskId":"1"}
```

返回：

```json
{"success":true,"taskId":"1","updatedFields":[],"verificationNudgeNeeded":false}
```

这说明该调用没有实际更新任何字段。

排障包进一步发现：

- 主会话中 20 次工具调用，18 次为 `TaskUpdate`，其中 17 次为空输入。
- 子代理中 36 次工具调用，28 次为空输入；其中 `TaskUpdate` 空输入 26 次，`Edit` 空输入 2 次。
- 因此问题不是 `TaskUpdate` 独有，而是 CoStrict/GLM-5 工具调用链路存在空参数工具调用风险。

## 环境信息

排障包 `environment.json` 显示：

```text
CLAUDE_CODE_USE_COSTRICT=1
CLAUDE_CODE_SUBAGENT_MODEL=GLM-5
modelType=costrict
model=GLM-5
```

因此本次问题发生在 CoStrict/OpenAI 兼容工具调用路径下。

## 根因分析

### 根因 1：兼容模型产生了空参数工具调用

OpenAI 兼容流适配逻辑会在收到工具调用开始事件时创建工具块：

```ts
input: {}
```

只有收到后续 `function.arguments` / `input_json_delta` 时，才会追加参数。

如果模型或网关只返回工具名，没有返回参数增量，最终 assistant message 中就会形成：

```json
{"type":"tool_use","name":"TaskUpdate","input":{}}
```

这会进入工具执行器，并被 `TaskUpdate` 的 zod schema 拦截。

### 根因 2：`TaskUpdate` 对空更新返回成功

`TaskUpdate` 原逻辑允许只传 `taskId`：

```json
{"taskId":"1"}
```

如果没有 `status`、`subject`、`description`、`owner` 等任何更新字段，工具不会写入任务文件，但仍返回：

```json
{"success":true,"updatedFields":[]}
```

这会误导模型认为操作成功，放大后续错误。

### 根因 3：Grok 路径绕过了统一空工具块过滤

OpenAI/CoStrict 路径已经使用 `getFinalContentBlocks()` 在最终组装 assistant message 时过滤无效空工具块。

但 Grok 路径原先在 `content_block_stop` 时逐块产出 assistant message，导致空工具占位块可能绕过统一过滤，直接进入执行器。

## 修复情况

### 修复 1：`TaskUpdate` 禁止空更新成功

文件：

- `packages/builtin-tools/src/tools/TaskUpdateTool/TaskUpdateTool.ts`

新增逻辑：

- 检查是否至少提供一个实际更新字段。
- 如果只提供 `taskId`，返回 `success: false`。
- 错误信息明确提示需要提供 `status`、`subject`、`description` 等字段。

效果：

```json
{"taskId":"1"}
```

现在会返回：

```text
No updates provided. Include at least one field such as status, subject, description, activeForm, owner, metadata, addBlocks, or addBlockedBy.
```

避免“假成功”。

### 修复 2：Grok 路径统一过滤空工具块

文件：

- `src/services/api/grok/index.ts`

调整内容：

- 不再在 `content_block_stop` 时立即产出单个 assistant message。
- 改为在 `message_stop` 时统一组装所有 content block。
- 组装前调用 `getFinalContentBlocks(contentBlocks, tools)`。

效果：

- `TaskUpdate {}` 这类 schema 不通过的空工具块会被丢弃。
- `TaskList {}` 这类允许空输入的工具仍会保留。
- Grok 行为与 OpenAI/CoStrict 路径一致。

### 修复 3：补全测试 mock，避免组合测试污染

文件：

- `src/costrict/provider/index.test.ts`

补充：

```ts
resolveGrokModel: (model: string) => model
```

原因：

- `costrict` 测试 mock 了 `@ant/model-provider`。
- 新增 Grok 测试同进程组合运行时，需要该 mock 也包含 Grok 使用的导出。

## 新增测试

### `TaskUpdate` 空更新测试

文件：

- `packages/builtin-tools/src/tools/TaskUpdateTool/__tests__/inputSchemaRuntime.test.ts`

覆盖：

- `TaskUpdate.call({ taskId: "1" })` 返回失败。
- 不调用 `updateTask()`。

### Grok 空工具块过滤测试

文件：

- `src/services/api/grok/index.test.ts`

覆盖：

- 输入流包含一个空 `TaskUpdate` 工具块和一个有效 `TaskUpdate` 工具块。
- 最终 assistant message 只保留有效工具调用。

### 既有 CoStrict/OpenAI 测试

相关文件：

- `src/costrict/provider/index.test.ts`
- `src/services/api/openai/toolUseBlocks.test.ts`

已覆盖：

- CoStrict 路径丢弃空无效工具块。
- 空输入但 schema 允许的工具不会被误删。

## 验证结果

已运行：

```bash
bun --conditions=@zod/source test packages/builtin-tools/src/tools/TaskUpdateTool/__tests__/inputSchemaRuntime.test.ts
bun --conditions=@zod/source test src/services/api/openai/toolUseBlocks.test.ts src/costrict/provider/index.test.ts src/services/api/grok/index.test.ts
```

测试主体通过。

注意：

- 当前工作区存在既有未解决冲突：
  - `package.json`
  - `scripts/generate-review-builtin.ts`
- 因 `package.json` 中存在冲突标记，Bun 测试结束时会额外打印 JSON 解析错误。
- `bunx tsc --noEmit --customConditions @zod/source` 仍失败，但错误来自仓库既有问题和无关文件，不在本次修复文件中。

## 剩余风险与后续建议

### 仍需增强：连续同类工具错误熔断

本次修复避免了空工具块进入部分路径，并避免 `TaskUpdate` 假成功，但尚未实现“同一工具同一 schema 错误连续多次后熔断”。

建议后续在工具执行层增加保护：

```text
同一 turn 内，同一工具连续 3 次出现相同 schema 错误时，返回强约束提示或停止继续工具循环。
```

目标是避免模型重复生成无效调用直到触发 429。

### 仍需增强：CoStrict 原始工具参数诊断

排障包没有 raw stream/debug 日志，因此无法最终确认空参数来自：

1. GLM-5 原始返回就是空 `arguments`。
2. CoStrict 网关丢失了 `arguments`。
3. 本地 OpenAI stream adapter 没接住参数增量。

建议在 OpenAI 兼容流适配层增加 debug 日志：

- tool call id
- tool name
- arguments 长度
- 是否最终没有收到参数
- finish_reason

避免记录完整参数内容，防止敏感信息泄露。

### 仍需确认：OpenAI tool schema required 字段

建议增加 schema 转换测试，确认 `TaskUpdate` 转 OpenAI tool schema 后仍包含：

```json
"required": ["taskId"]
```

如果 required 丢失，兼容模型会更容易生成 `{}`。

## 当前结论

本次异常的直接触发点是 CoStrict/GLM-5 工具调用链路产生了大量空参数工具调用。`TaskUpdate` 自身对空更新返回成功进一步放大了问题。

已完成的修复可以降低两类风险：

1. `TaskUpdate({"taskId":"1"})` 不再被误判为成功。
2. Grok/OpenAI 兼容路径中的空无效工具占位块会在最终组装时被过滤。

后续如果仍在 CoStrict/GLM-5 下出现空工具调用，需要进一步结合 raw stream 日志判断是模型原始输出问题还是网关/适配层问题。

## 新 session 进一步分析

新增会话文件：

- `bug/6ee7da88-332a-4b09-a8e1-e4d684c859d8/6ee7da88-332a-4b09-a8e1-e4d684c859d8.jsonl`

对应任务目录：

- `bug/6ee7da88-332a-4b09-a8e1-e4d684c859d8/6ee7da88-332a-4b09-a8e1-e4d684c859d8/`

该 session 只有一次有效工具调用：

```json
{
  "name": "TaskCreate",
  "input": {
    "activeForm": "测试任务进行中",
    "description": "这是一个用于测试任务列表功能的示例任务，用于验证任务的创建、状态更新和完成标记是否正常工作。",
    "subject": "测试任务列表功能"
  }
}
```

`TaskCreate` 返回成功：

```text
Task #1 created successfully: 测试任务列表功能
```

但 transcript 中没有任何 `TaskUpdate` 记录，也没有 `InputValidationError` 或 API 错误。任务文件最终状态为：

```json
{
  "id": "1",
  "subject": "测试任务列表功能",
  "status": "pending"
}
```

这说明新故障不是“`TaskUpdate` 执行后失败”，而是 `TaskCreate` 后更新动作没有进入可见执行链路。

### 新根因：唯一空工具调用被静默丢弃

进一步排查发现，OpenAI/CoStrict/Grok 兼容路径存在两层空工具调用过滤：

1. provider 组装层：`getFinalContentBlocks(contentBlocks, tools)`
2. 主循环/工具执行层：`filterEmptyInvalidToolUseMessages(...)`

旧过滤策略会丢弃 `input` 为 `{}`、`""` 或 `"{}"`，且目标工具 schema 不接受空对象的工具块。这个策略可以避免无效空工具块进入执行器，但新 session 暴露了一个副作用：

```text
如果某一轮模型只产生了一个空的 TaskUpdate 工具调用，该工具块会被全部过滤掉。
过滤后没有 assistant message，也没有 tool_result，主循环认为本轮没有后续工具需要执行，于是直接结束。
```

因此用户看到的现象就是：

```text
任务创建成功，但没有任何更新失败提示，任务保持 pending。
```

### 补充修复

为避免“无声结束”，已调整空工具调用过滤策略：

文件：

- `src/services/api/openai/toolUseBlocks.ts`
- `src/services/tools/emptyInvalidToolUseFilter.ts`

新策略：

1. 如果同一批 content block 中同时存在有效内容和空无效工具块，继续丢弃空无效工具块。
2. 如果整批只剩空无效工具块，则保留它，让标准工具校验路径返回 `InputValidationError`。

伪代码：

```text
ordered = 按 index 排序后的所有 content block
filtered = ordered 去掉空无效工具块

if filtered 不为空:
  return filtered

return ordered
```

工具执行层同样增加保护：

```text
if 要丢弃的工具块数量 == 本批工具块数量:
  保留本批工具块
else:
  只丢弃空无效工具块
```

这样可以保留两类能力：

- 混合场景下，空占位不会阻塞同批有效工具调用。
- 单独空工具调用场景下，不再静默吞掉，而是返回标准 schema 校验错误，给模型一次修正机会。

### 新增验证

已新增/更新测试：

- `src/services/api/openai/toolUseBlocks.test.ts`
- `src/services/tools/__tests__/toolOrchestration.test.ts`
- `src/costrict/provider/index.test.ts`
- `src/services/api/grok/index.test.ts`

覆盖场景：

1. 空 `TaskUpdate` + 有效 `TaskUpdate`：保留有效调用，丢弃空调用。
2. 单独空 `TaskUpdate`：保留工具块，让后续校验层返回 `InputValidationError`。
3. `TaskList` 这类允许空输入的工具：不被误删。

已运行：

```bash
bun --conditions=@zod/source test src/services/api/openai/toolUseBlocks.test.ts
bun --conditions=@zod/source test src/services/tools/__tests__/toolOrchestration.test.ts
bun --conditions=@zod/source test src/costrict/provider/index.test.ts src/services/api/grok/index.test.ts
```

结果：

```text
src/services/api/openai/toolUseBlocks.test.ts: 5 pass
src/services/tools/__tests__/toolOrchestration.test.ts: 5 pass
src/costrict/provider/index.test.ts + src/services/api/grok/index.test.ts: 7 pass
```

### 当前最终结论

两次 session 共同说明 tasks 工具异常有两个层次：

1. 原始问题：CoStrict/GLM-5 可能产生空参数工具调用，导致 `TaskUpdate` 校验失败风暴，甚至触发 429。
2. 新问题：为了过滤空工具调用，旧修复在“唯一空工具调用”场景下把整轮响应静默吞掉，导致任务创建后不再更新，也没有错误提示。

当前修复后的预期行为：

```text
TaskCreate 成功后，如果模型错误地产生空 TaskUpdate：
  CLI 会保留该工具调用
  工具执行层返回 InputValidationError
  主循环把错误反馈给模型
  模型有机会补发 {"taskId":"1","status":"completed"}
```

该修复不会让空 `TaskUpdate` 直接成功执行，也不会恢复旧的“只传 taskId 也成功”的假成功行为。
