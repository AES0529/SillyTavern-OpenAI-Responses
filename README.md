# SillyTavern OpenAI Responses

为 SillyTavern 增加一个可见的 **OpenAI Responses** 聊天补全来源，并把酒馆现有的 Chat Completions 请求与响应实时转换为 OpenAI Responses API 格式。

本项目不修改 SillyTavern 核心文件。同一份仓库同时包含：

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

该扩展需要把**同一个 Git 仓库安装两次**。发布到 GitHub 后，将下面的 `<仓库地址>` 换成你的仓库 URL。

### 1. 安装前端扩展

在 SillyTavern 的“扩展”面板中选择“安装扩展”，粘贴：

```text
<仓库地址>
```

也可以把仓库复制到：

```text
SillyTavern/public/scripts/extensions/third-party/openai-responses
```

### 2. 安装服务端插件

在 SillyTavern 根目录运行：

```bash
node plugins.js install <仓库地址>
```

也可以把仓库复制到：

```text
SillyTavern/plugins/openai-responses
```

确认 `config.yaml` 中启用了服务端插件：

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

## 已验证的兼容服务

### OpenCode Zen — Muse Spark 1.2 Contributor

以下配置已于 2026-08-26 通过普通响应与 SSE 流式响应实测：

- Reverse Proxy：`https://opencode.ai/zen/go/v1/`
- 手动模型 ID：`muse-spark-1.2-contributor`
- 协议端点：`POST /responses`
- API Key：填写在 SillyTavern 的反向代理密码/API Key 输入框中，不要写入本仓库

该模型会使用一部分输出 token 进行推理。实测将最大输出设为 64 时，预算可能在正文生成前耗尽；建议至少设为 512，长回复则使用更高上限。

## 当前限制

- Responses API 一次只生成一个候选，因此不支持单请求 Multi-swipe；仍可使用酒馆的滑动重生成。
- `frequency_penalty`、`presence_penalty`、`seed`、`logit_bias`、`stop` 和响应侧图片生成未映射；选择本来源时相关控件会隐藏。
- Responses 的 reasoning summary 会转换为 `reasoning_content`，但当前 SillyTavern 对原生 OpenAI 来源不会显示该字段；最终回答与工具调用不受影响。
- 扩展依赖 SillyTavern 当前的前端模块路径和服务端 secrets API。已按 SillyTavern `release` 1.18.0（提交 `8172dcd`）实现。

## 开发验证

要求 Node.js 20 或更高版本：

```bash
npm test
npm run check
```

## 发布到 GitHub

先在 GitHub 新建一个空仓库，例如 `SillyTavern-OpenAI-Responses`。不要让 GitHub 自动创建 README、License 或 `.gitignore`，因为本项目已经包含这些文件。

在本项目根目录运行：

```bash
git init -b main
git add .
git commit -m "Initial release: OpenAI Responses support"
git remote add origin https://github.com/<你的用户名>/SillyTavern-OpenAI-Responses.git
git push -u origin main
```

首次发布可以再创建 `v0.1.0` 标签：

```bash
git tag v0.1.0
git push origin v0.1.0
```

然后在 GitHub 仓库的 **Releases** 页面选择 **Draft a new release**，选取 `v0.1.0` 标签并发布。GitHub 会自动提供源码 ZIP；也可以额外上传本项目预先生成的安装包。

发布后，请把安装说明中的 `<仓库地址>` 替换为真实仓库 URL，并按需把 `manifest.json` 中的 `author` 改为你的 GitHub 用户名。

## 安全说明

- API Key 仍由 SillyTavern 的 secrets 系统保存；前端扩展不会读取已保存的明文密钥。
- 服务端插件仅把密钥发送到 OpenAI 官方地址或你在 SillyTavern 中明确配置的 Reverse Proxy。
- 安装服务端插件前请像审查其他 SillyTavern server plugin 一样审查源码。

## License

AGPL-3.0-only
