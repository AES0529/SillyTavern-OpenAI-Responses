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
- JSON Schema Structured Outputs
- Reasoning effort、verbosity、Web Search
- `store: false`（默认）或允许 OpenAI 存储 Response
- Responses usage 到 Chat Completions usage 的映射
- 无状态工具调用所需的加密 reasoning item 回传

## 安装

该扩展需要把**同一个 Git 仓库安装两次**。

### 1. 安装前端扩展

在 SillyTavern 的“扩展”面板中选择“安装扩展”，粘贴：

```text
https://github.com/AES0529/SillyTavern-OpenAI-Responses
```

### 2. 安装服务端插件

在 SillyTavern 根目录运行：

```bash
node plugins.js install https://github.com/AES0529/SillyTavern-OpenAI-Responses
```

并确认 `config.yaml` 中启用了服务端插件：

```yaml
enableServerPlugins: true
```

然后完整重启 SillyTavern。

## 使用

1. 打开“API 连接”。
2. API 选择“聊天补全（Chat Completion）”。
3. “聊天补全来源”选择 **OpenAI Responses**。
4. 像原生 OpenAI 来源一样填写 API Key、Reverse Proxy（可选）并选择模型。
5. 点击“连接”，然后开始聊天。

如果模型没有出现在列表中，可在“扩展”设置里的 OpenAI Responses 面板手动填写模型 ID。

Reverse Proxy 应填写 API 基础地址，例如 `https://api.openai.com/v1`；插件会在末尾追加 `/responses`。

## 当前限制

- Responses API 一次只生成一个候选，不支持同时并发多个回复。
- `frequency_penalty`、`presence_penalty`、`seed`、`logit_bias`、`stop` 和响应侧图片生成未映射；选择本来源时相关控件会隐藏。
- Responses 的 reasoning summary 会转换为 `reasoning_content`，但当前 SillyTavern 对原生 OpenAI 来源不会显示该字段；最终回答与工具调用不受影响。
- 扩展依赖 SillyTavern 当前的前端模块路径和服务端 secrets API。已按 SillyTavern `release` 1.18.0（提交 `8172dcd`）实现。

## 开发验证

要求 Node.js 20 或更高版本：

## 安全说明

- API Key 仍由 SillyTavern 的 secrets 系统保存；前端扩展不会读取已保存的明文密钥。
AGPL-3.0-only
