# CSC 单主题状态栏设计

## 目标

将 CSC 现有状态栏改为内置单主题实现，借鉴 `ccstatusline` 的高对比 Powerline 视觉风格，但不引入其配置系统、TUI 或外部命令执行模型。

同时彻底移除原有自定义 `statusLine.command` 机制，删去 trust、命令执行、超时和输出解析这条链路。状态栏只保留一个固定主题，并继续受 `statusLineEnabled` 总开关控制。

## 范围

本设计只覆盖终端 REPL 的底部状态栏。

覆盖内容：

- 内置状态栏的固定主题渲染
- `model`、`context`、`cache`、`cost`、`git branch + diff` 五类信息
- Powerline 字符优先、ASCII 自动回退
- `statusLineEnabled` 显隐控制
- 配置与 UI 中 `statusLine.command` 的移除

不包含：

- 多主题切换
- 运行时外部命令托管
- `ccstatusline` 的完整 widget 配置/TUI
- 设置页以外的其他展示点同步更新
- 顶部栏、消息流、活动轨迹或侧栏改造

## 架构

状态栏保留现有入口，但语义改为“固定主题的内置渲染器”。

数据仍从 CSC 运行时上下文获取，来源不变：

- 当前模型
- 上下文占用
- 缓存命中/倒计时
- 累计费用
- git 分支和变更数

渲染层分两部分：

- `src/utils/widgetBar.ts` 负责把运行时数据归一为固定段列表
- `src/components/widget-bar/WidgetBar.tsx` 负责按终端能力渲染 Powerline 或 ASCII 版

`src/components/StatusLine.tsx` 只负责组装状态栏上下文和显隐判断。原有 `statusLine.command` 的执行逻辑、trust 检查和命令输出渲染全部删除。

## 数据流

1. REPL 渲染时读取现有状态栏上下文。
2. `deriveWidgetBarState()` 生成固定顺序段：`model -> context -> cache -> cost -> branch+diff`。
3. `WidgetBar` 根据终端能力选择：
   - 支持 Powerline 字符时输出高对比分段样式
   - 否则输出 ASCII 回退样式
4. 若字段缺失，对应段直接省略，不显示占位符。
5. 若 `statusLineEnabled === false`，整条状态栏不渲染。

## 视觉规则

默认主题采用高对比 Powerline 风格，保留 `ccstatusline` 的分段阅读方式，但使用 CSC 自身的配色体系。

字段顺序固定：

1. 模型
2. 上下文占用
3. 缓存命中
4. 累计费用
5. git 分支 + 改动数

ASCII 回退时使用同序的分段文本，保证信息顺序一致，只改变外观，不改变内容。

## 配置变更

移除以下配置和行为：

- `statusLine.command`
- 执行状态栏 shell 命令的 trust 提示
- 命令超时与空输出处理
- 命令结果注入状态栏的逻辑

保留：

- `statusLineEnabled`

## 错误处理

状态栏必须 best-effort：

- 模型、上下文、缓存、费用或 git 数据缺失时，只省略对应段
- Powerline 字符不可用时自动回退 ASCII
- git 或缓存读取异常不影响主界面输入
- 不再存在命令执行失败、trust 拒绝或超时错误态

## 测试

需要覆盖：

- 固定段顺序
- 字段缺失时的段省略
- 窄宽度下的裁剪行为
- Powerline 与 ASCII 回退选择
- `statusLineEnabled` 显隐行为
- `statusLine.command` 已从配置与渲染路径移除

## 实现备注

建议修改顺序：

1. 精简 `src/utils/widgetBar.ts`
2. 重写 `src/components/widget-bar/WidgetBar.tsx`
3. 删除 `src/components/StatusLine.tsx` 中的命令执行链路
4. 清理 `src/utils/settings/types.ts` 中的 `statusLine.command`
5. 更新相关设置 UI 和测试
