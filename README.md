# SillyTavern OpenAI Responses

为 SillyTavern 增加一个可见的 **OpenAI Responses** 聊天补全来源，并把酒馆现有的 Chat Completions 请求与响应实时转换为 OpenAI Responses API 格式。

本项目包含：

- 前端扩展：增加来源选项、设置界面和请求桥接。
- 服务端插件：安全读取酒馆保存的 OpenAI 密钥，调用 `POST /v1/responses`，再把普通响应或 SSE 流转换回酒馆可识别的格式。

## 已支持

- 普通生成与流式生成
- OpenAI 模型列表、API Key 与 Reverse Proxy 配置复用
- 手动填写模型 ID
- 文本与图片输入
- SillyTavern 函数工具调用及工具结果回传
- 已兼容SillyTavern 1.14.0、1.15.0、1.16.0、1.17.0 与 1.18.0

## 安装

该扩展需要把**同一个 Git 仓库安装两次**。

### 1. 安装前端扩展

在 SillyTavern 的“扩展”面板中选择“安装扩展”，粘贴：

```text
https://github.com/AES0529/SillyTavern-OpenAI-Responses
```

### 2. 安装服务端插件

确认 `config.yaml` 中启用了服务端插件：

```yaml
enableServerPlugins: true
```

并在 SillyTavern 根目录运行：

```bash
node plugins.js install https://github.com/AES0529/SillyTavern-OpenAI-Responses
```

然后完整重启 SillyTavern。

### 已安装旧版本时升级

1. 在 SillyTavern 的扩展面板中更新 **OpenAI Responses** 前端扩展。
2. 在 SillyTavern 根目录运行 `node plugins.js update`，更新服务端插件。
3. 完整重启 SillyTavern，并在浏览器中按 `Ctrl+F5` 强制刷新。

## 使用

1. 打开“API 连接”。
2. API 选择“聊天补全（Chat Completion）”。
3. “聊天补全来源”选择 **OpenAI Responses**。
4. 像原生 OpenAI 来源一样填写 API Key、Reverse Proxy（可选）并选择模型。
5. 点击“连接”，然后开始聊天。

如果模型没有出现在列表中，可在“扩展”设置里的 OpenAI Responses 面板手动填写模型 ID。

Reverse Proxy 应填写 API 基础地址，例如 `https://api.openai.com/v1`；插件会在末尾追加 `/responses`。

## OpenCode Go、OpenCode Zen 与 Muse Spark

OpenCode Go 要求每个聊天使用一个稳定的 `x-opencode-session` 请求头。插件也会对 OpenCode Zen 做预防性兼容，在当前地址属于以下任一官方地址族时自动处理：

- `https://opencode.ai/zen/go/`（OpenCode Go）
- `https://opencode.ai/zen/v1/`（OpenCode Zen）

- 第一次发送消息时生成 `ses_...` ID。
- ID 保存在当前聊天的 `chatMetadata.opencode_go_session_id` 中。
- 同一个聊天始终复用；新聊天会生成新的 ID。
- 请求发送到其他网站或 `opencode.ai` 的其他路径时不会携带这个自动生成的 ID。

配置步骤：

1. “聊天补全来源”选择 **OpenAI Responses**。
2. 填入 OpenCode Go API Key。
3. Reverse Proxy 填写 `https://opencode.ai/zen/go/v1`。
4. 在扩展设置中手动应用模型 ID，例如 `muse-spark-1.3-contributor` 或 `muse-spark-1.2-contributor`。
5. 保持“仅对 OpenCode Go / Zen 官方地址自动添加 x-opencode-session”开启，然后连接并发送消息。

如果使用 OpenCode Zen，则把 Reverse Proxy 改为 `https://opencode.ai/zen/v1`；填写基础地址或已带 `/responses` 的完整地址都能识别。

扩展设置会显示当前聊天 ID，并提供复制和“为本聊天换一个 ID”按钮。不需要在附加请求头框中手写 `x-opencode-session`；即使留有旧值，自动生成的当前聊天 ID 也会覆盖它。

## 附加请求参数和请求头

选择 **OpenAI Responses** 后，SillyTavern 会在 API 连接区的“连接”按钮旁显示原生 **Additional Parameters / 附加参数** 按钮。插件直接复用这个弹窗和酒馆原生设置，不再需要到扩展面板填写。

弹窗中的三个输入框同时接受 YAML 或 JSON：

附加请求体示例：

```yaml
max_tool_calls: 8
metadata:
  client: SillyTavern
```

排除请求体字段示例：

```yaml
- temperature
- include
```

附加请求头示例：

```yaml
X-Custom-Header: custom-value
User-Agent: My-SillyTavern/1.0
```

附加请求体会在标准 Responses 转换完成后合并，因此可以加入供应商专用参数，也可以覆盖已有参数；随后再应用排除字段。格式错误时，插件会返回清楚的 400 错误，而不是静默丢弃配置。

从 v0.4.x 升级时，原来填写在扩展面板里的内容会自动迁移到原生字段。若原生字段本来已有内容，插件会保留原生内容，避免覆盖现有 Custom 连接配置。

## 网络代理

1. **Windows 系统代理**：自动读取 Windows 当前启用的手动代理或 PAC 地址，兼容 Clash、Mihomo 等软件的“系统代理”模式；代理开关变化会在约 5 秒内生效。
2. **SillyTavern requestProxy**：适用于 Windows、Linux、macOS 和 Docker，也是跨平台推荐方式。
3. **环境变量**：支持 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 和 `NO_PROXY`。

SillyTavern 的 `requestProxy` 可在根目录的 `config.yaml` 中配置：

```yaml
requestProxy:
  enabled: true
  url: "http://127.0.0.1:7890"
  bypass:
    - localhost
    - 127.0.0.1
```

请把示例端口 `7890` 换成代理软件显示的 HTTP/Mixed 端口，然后完整重启 SillyTavern。SOCKS 代理也可以使用，例如 `socks5://127.0.0.1:7891`。

注意：“API 连接”页面里的 **Reverse Proxy** 是模型服务的 API 基础地址，不是网络代理。TUN 模式仍然可以使用，但在 Windows 上开启普通“系统代理”后，插件现在也能自动跟随。

## 当前限制

- Responses API 一次只生成一个候选，不支持同时并发多个回复。
- `frequency_penalty`、`presence_penalty`、`seed`、`logit_bias`、`stop` 和响应侧图片生成未映射；选择本来源时相关控件会隐藏。
- Responses 的 reasoning summary 会转换为 `reasoning_content`，但当前 SillyTavern 对原生 OpenAI 来源不会显示该字段；最终回答与工具调用不受影响。
- 最低支持 SillyTavern 1.14.0；1.14.0 至 1.18.0 的前端接口和服务端插件接口已逐版核对。

## 开发验证

要求 Node.js 18 或更高版本：

```bash
npm test
npm run check
```

## 安全说明

- API Key 仍由 SillyTavern 的 secrets 系统保存；前端扩展不会读取已保存的明文密钥。
- 附加参数和请求头保存在扩展设置中，请勿把 API Key 或其他长期密钥填入这些输入框。
- `Host`、`Content-Length`、`Connection`、`Transfer-Encoding` 等由网络层控制的请求头会被拒绝。
- 自动生成的会话 ID 只会发送到 `https://opencode.ai/zen/go/` 或 `https://opencode.ai/zen/v1/` 路径下的 HTTPS 地址。

## License

AGPL-3.0-only
