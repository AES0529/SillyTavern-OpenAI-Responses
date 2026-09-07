# Changelog

## 0.4.1

- 将自动 `x-opencode-session` 支持扩展到 OpenCode Zen 的 `https://opencode.ai/zen/v1` 地址族。
- OpenCode Go 与 Zen 均支持 Reverse Proxy 填写基础地址或已带具体 `/responses` 路径。
- 继续要求 HTTPS、精确 `opencode.ai` 域名和明确路径，其他 Responses Proxy 不会收到自动会话 ID。

## 0.4.0

- 增加 YAML/JSON 格式的附加请求体、排除字段和附加 HTTP 请求头。
- 自动为 OpenCode Go Responses 请求添加 `x-opencode-session`。
- 会话 ID 保存在聊天元数据中：同一聊天稳定复用，新聊天使用新 ID。
- 自动会话 ID 仅发送到 OpenCode Go 官方 HTTPS 地址，并覆盖大小写不同的旧值。
- 增加当前聊天 ID 查看、复制、轮换和调试状态界面。
- 出站请求使用可识别的 `SillyTavern-OpenAI-Responses/<version>` User-Agent。
- 无效 YAML/JSON 和不安全的传输层请求头现在返回明确错误。

## 0.3.0

- 最低支持版本调整为 SillyTavern 1.14.0。
- 增加旧版自动启动兼容层：SillyTavern 1.14-1.16 无扩展激活钩子时也能初始化。
- 初始化流程改为幂等，兼容 SillyTavern 1.17-1.18 的 `activate` 钩子且不会重复添加界面和事件。
- Node.js 最低要求调整为 18，与 SillyTavern 1.14-1.16 保持一致。

## 0.2.0

- 支持 SillyTavern `requestProxy` 出站代理。
- 支持 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 与 `NO_PROXY` 环境变量。
- Windows 下自动读取系统手动代理、绕过列表与 PAC 地址，切换代理后无需重启插件。
- 服务端请求改用 SillyTavern 已包含的 `node-fetch` 和 `proxy-agent`，普通响应与 SSE 流式响应均经过同一代理链。

## 0.1.0

- 首次发布，支持 OpenAI Responses 普通与流式生成。
