# Changelog

## 0.2.0

- 支持 SillyTavern `requestProxy` 出站代理。
- 支持 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 与 `NO_PROXY` 环境变量。
- Windows 下自动读取系统手动代理、绕过列表与 PAC 地址，切换代理后无需重启插件。
- 服务端请求改用 SillyTavern 已包含的 `node-fetch` 和 `proxy-agent`，普通响应与 SSE 流式响应均经过同一代理链。

## 0.1.0

- 首次发布，支持 OpenAI Responses 普通与流式生成。
