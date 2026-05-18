# Plugin Auto-Update 机制说明

本文记录当前代码中的 plugin auto-update 机制，包括启动链路、配置来源、UI 配置项、手动更新行为，以及复核时发现的配置注意点。

## 结论摘要

Plugin auto-update 是启动后的后台任务，用于刷新开启了 `autoUpdate` 的 marketplaces，并把这些 marketplaces 下已安装且与当前项目相关的 plugins bump 到新版本缓存。

它由两层配置决定：

1. Plugin auto-update 门禁不能处于跳过状态：`DISABLE_AUTOUPDATER=1` 会关闭它，除非设置 `FORCE_AUTOUPDATE_PLUGINS=true` 强制运行。
2. 单个 marketplace 必须被判定为 `autoUpdate: true`。

更新是 disk-only：后台任务只更新版本缓存和 `installed_plugins.json`，当前会话内存中的 plugin 列表不会立即替换。用户需要运行 `/reload-plugins` 或重启后才会使用新版本。

## 启动链路

后台入口在 `src/utils/backgroundHousekeeping.ts`：

- `startBackgroundHousekeeping()` 会调用 `autoUpdateMarketplacesAndPluginsInBackground()`。
- REPL 中第一次提交后会启动 housekeeping。
- headless 主流程在非 bare 模式下也会动态导入并启动 housekeeping。

核心实现位于 `src/utils/plugins/pluginAutoupdate.ts`：

1. `autoUpdateMarketplacesAndPluginsInBackground()` 先调用 `shouldSkipPluginAutoupdate()`。
2. 如果未跳过，读取启用 auto-update 的 marketplaces。
3. 对这些 marketplaces 调用 `refreshMarketplace()`。
4. 调用 `updatePluginsForMarketplaces()` 更新这些 marketplaces 下已安装的 plugins。
5. 如果有 plugin 被更新，通过 `onPluginsAutoUpdated()` 通知 UI。

后台刷新 marketplace 时会传入 `disableCredentialHelper: true`，避免启动后台任务触发交互式凭据提示。

## Plugin Auto-Update 门禁

门禁在 `src/utils/config.ts` 的 `shouldSkipPluginAutoupdate()`：

- 默认不跳过 plugin auto-update，因此 `/plugin marketplace` 中的 `Enable/Disable auto-update` 默认可见。
- `DISABLE_AUTOUPDATER=1` 会跳过 plugin auto-update，并隐藏 marketplace 详情里的 `Enable/Disable auto-update`。
- `FORCE_AUTOUPDATE_PLUGINS=1` 可以在 `DISABLE_AUTOUPDATER=1` 时重新启用 plugin auto-update 及其 UI 配置入口。

这与官方插件文档中的配置方式一致：如果用户禁用了自动更新，但仍希望插件自动更新可配置/可运行，可同时设置：

```bash
export DISABLE_AUTOUPDATER=1
export FORCE_AUTOUPDATE_PLUGINS=1
```

注意：`/config` 中的 CLI binary auto-update 状态、development build 限制、`ENABLE_AUTOUPDATER` 门禁和 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` 不再决定 plugin marketplace 的 per-marketplace auto-update 开关是否可见。

## Marketplace `autoUpdate` 判定

判定逻辑在 `src/utils/plugins/schemas.ts` 的 `isMarketplaceAutoUpdate()`：

- 如果 marketplace entry 明确设置了 `autoUpdate`，使用显式值。
- 否则，官方 marketplace 默认开启 auto-update。
- 第三方 marketplace 默认关闭 auto-update。
- `knowledge-work-plugins` 虽在官方名称集合中，但默认不自动更新。

官方名称集合包括：

- `claude-code-marketplace`
- `claude-code-plugins`
- `claude-plugins-official`
- `anthropic-marketplace`
- `anthropic-plugins`
- `agent-skills`
- `life-sciences`
- `knowledge-work-plugins`

其中 `knowledge-work-plugins` 在 `NO_AUTO_UPDATE_OFFICIAL_MARKETPLACES` 中，因此默认关闭。

## 配置来源和优先级

Plugin auto-update 涉及两类 marketplace 配置：

1. 状态层：`known_marketplaces.json`
   - schema 在 `KnownMarketplaceSchema`。
   - 字段包括 `source`、`installLocation`、`lastUpdated`、可选 `autoUpdate`。
   - 记录已 materialized 的 marketplace 缓存位置和刷新状态。

2. 意图层：settings 中的 `extraKnownMarketplaces`
   - schema 在 `ExtraKnownMarketplaceSchema`。
   - 也支持可选 `autoUpdate`。
   - 用于 user/project/local/managed settings 声明希望存在的 marketplace。

自动更新读取启用 marketplaces 时，会先读取 `known_marketplaces.json`，再用 settings 声明的 `extraKnownMarketplaces[name].autoUpdate` 覆盖状态层值。也就是说，settings 声明的 `autoUpdate` 优先于 `known_marketplaces.json` 中的 `autoUpdate`。

`getDeclaredMarketplaces()` 的合并顺序是：

1. 隐式官方 marketplace 声明。
2. `--add-dir` 里的 extra marketplaces。
3. merged settings 里的 `extraKnownMarketplaces`。

## `/plugin marketplace` UI

Marketplace 管理 UI 在 `src/commands/plugin/ManageMarketplaces.tsx`。

详情菜单包含：

- `Browse plugins`
- `Update marketplace`
- `Enable auto-update` 或 `Disable auto-update`
- `Remove marketplace`

`Enable/Disable auto-update` 只有在 `shouldSkipPluginAutoupdate()` 为 false 时才显示。默认情况下该条件为 false，因此 marketplace auto-update 配置默认可见。只有显式设置 `DISABLE_AUTOUPDATER=1` 且未设置 `FORCE_AUTOUPDATE_PLUGINS=1` 时才会隐藏。

点击该开关后会调用 `setMarketplaceAutoUpdate()`：

- 更新 `known_marketplaces.json` 中该 marketplace 的 `autoUpdate`。
- 如果该 marketplace 是 settings 声明的，还会写回声明它的同一个 settings source，避免下次被 settings 覆盖。
- seed-managed marketplace 不允许切换 auto-update，会报错提示 seed 内容由管理员控制。

当某 marketplace 的 auto-update 已启用时，详情页底部会显示说明：CoStrict 会自动更新该 marketplace 及其已安装 plugins。

## `/config` UI

`/config` 中的 `Auto-update channel` 属于全局 CLI auto-updater 配置，不是 plugin 专用配置。

它会展示：

- `latest`
- `stable`
- `disabled` 和 disabled reason

Plugin auto-update 不使用 `latest/stable` channel 来选择插件版本，也不通过 `/config` 配置。插件版本来自 marketplace 刷新后的 plugin source、manifest version、git commit 等版本计算逻辑。

## 手动更新和自动更新的区别

手动更新路径包括：

- `/plugin marketplace update`
- marketplace 详情页中的 `Update marketplace`

手动更新会：

1. 调用 `refreshMarketplace()` 刷新指定 marketplace。
2. 调用 `updatePluginsForMarketplaces()` bump 该 marketplace 下已安装的 plugins。
3. 清理缓存并刷新 UI 状态。

手动更新不依赖该 marketplace 的 `autoUpdate` 标记，也不通过后台 auto-update 的通知回调。它是用户主动操作。

自动更新只处理 auto-update enabled marketplaces，并在后台静默执行；失败通常只写 debug log，不阻塞用户。

## Plugin 更新细节

实际 plugin bump 由 `src/services/plugins/pluginOperations.ts` 的 `updatePluginOp()` 完成：

1. 解析 plugin ID。
2. 从 marketplace 找到 plugin entry。
3. 从 `installed_plugins.json` 找到对应 scope 和 projectPath 的安装记录。
4. 对远程 source 下载临时副本；对本地 source 使用 marketplace 中的相对路径。
5. 调用 `calculatePluginVersion()` 计算新版本。
6. 如果当前安装已经是新版本，返回 already up to date。
7. 否则复制到 versioned cache。
8. 调用 `updateInstallationPathOnDisk()` 写回 `installed_plugins.json`。
9. 如果旧版本路径不再被任何安装引用，标记为 orphaned。

`updateInstallationPathOnDisk()` 只改磁盘文件，并清掉 installed plugins cache；它不会更新当前会话中的 in-memory installed plugins。这个设计保证后台更新不会在运行中替换正在使用的 plugin。

## Pending 更新和通知

后台 auto-update 成功后：

- 如果 REPL 已注册 callback，立即调用 callback。
- 如果 auto-update 先完成而 REPL hook 尚未注册，会先保存到 `pendingNotification`，注册后补发。

UI hook 在 `src/hooks/notifs/usePluginAutoupdateNotification.tsx`：

- remote mode 下不显示。
- 通知内容为 plugin 名称和 `Run /reload-plugins to apply`。
- 通知优先级为 low，默认 10 秒超时。

`getAutoUpdatedPluginNames()` 会通过 `hasPendingUpdates()` 判断磁盘安装记录和内存安装记录是否不同，并返回 pending update 的 plugin 名称。

## 关键注意点

- Plugin marketplace auto-update 配置默认可见。
- `DISABLE_AUTOUPDATER=1` 会关闭 plugin auto-update；`FORCE_AUTOUPDATE_PLUGINS=1` 可专门恢复 plugin auto-update。
- 官方 marketplaces 默认 auto-update，第三方 marketplaces 默认不 auto-update。
- settings 中 `extraKnownMarketplaces[name].autoUpdate` 优先于 `known_marketplaces.json`。
- 手动 marketplace update 会同步 bump 已安装 plugins，但不等于开启 auto-update。
- auto-update 是 disk-only；当前会话需要 `/reload-plugins` 或重启才能应用。
- `/config` 的 `Auto-update channel` 不决定 plugin 版本来源。
