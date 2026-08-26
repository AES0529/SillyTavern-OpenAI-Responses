const SIGNATURE_PREFIX = 'st-openai-responses-v1:';

function compactObject(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function numberOrUndefined(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function stringifyToolOutput(content) {
    if (typeof content === 'string') return content;
    if (content === null || content === undefined) return '';
    if (Array.isArray(content)) {
        return content.map(part => part?.text ?? part?.content ?? JSON.stringify(part)).join('\n');
    }
    return JSON.stringify(content);
}

function convertContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return stringifyToolOutput(content);

    const converted = [];
    for (const part of content) {
        if (!part || typeof part !== 'object') continue;

        if (part.type === 'text' || part.type === 'input_text') {
            converted.push({ type: 'input_text', text: String(part.text ?? '') });
        } else if (part.type === 'image_url' || part.type === 'input_image') {
            const image = part.image_url;
            const imageUrl = typeof image === 'string' ? image : image?.url;
            if (imageUrl) {
                converted.push(compactObject({
                    type: 'input_image',
                    image_url: imageUrl,
                    detail: part.detail ?? image?.detail,
                }));
            }
        } else if (part.type === 'input_audio' && part.input_audio) {
            converted.push({ type: 'input_audio', input_audio: part.input_audio });
        } else if (part.type === 'input_file') {
            converted.push(compactObject({
                type: 'input_file',
                file_id: part.file_id,
                file_url: part.file_url,
                file_data: part.file_data,
                filename: part.filename,
            }));
        }
    }

    return converted.length ? converted : '';
}

export function encodeReasoningSignature(items) {
    const reasoningItems = (Array.isArray(items) ? items : [])
        .filter(item => item?.type === 'reasoning' && item?.encrypted_content)
        .map(item => compactObject({
            type: 'reasoning',
            id: item.id,
            encrypted_content: item.encrypted_content,
            summary: Array.isArray(item.summary) ? item.summary : [],
        }));

    if (!reasoningItems.length) return null;
    return SIGNATURE_PREFIX + Buffer.from(JSON.stringify(reasoningItems), 'utf8').toString('base64url');
}

export function decodeReasoningSignature(value) {
    if (typeof value !== 'string' || !value.startsWith(SIGNATURE_PREFIX)) return [];
    try {
        const decoded = JSON.parse(Buffer.from(value.slice(SIGNATURE_PREFIX.length), 'base64url').toString('utf8'));
        return Array.isArray(decoded) ? decoded.filter(item => item?.type === 'reasoning' && item?.encrypted_content) : [];
    } catch {
        return [];
    }
}

function collectReasoningSignatures(message) {
    const candidates = [
        message?.signature,
        ...(Array.isArray(message?.tool_calls) ? message.tool_calls.map(call => call?.signature) : []),
    ];
    const seen = new Set();
    const result = [];

    for (const candidate of candidates) {
        for (const item of decodeReasoningSignature(candidate)) {
            const key = item.id ?? item.encrypted_content;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(item);
        }
    }
    return result;
}

export function convertMessages(messages) {
    const input = [];
    for (const message of Array.isArray(messages) ? messages : []) {
        if (!message || typeof message !== 'object') continue;

        const role = message.role === 'function' ? 'tool' : message.role;
        if (role === 'tool') {
            if (message.tool_call_id) {
                input.push({
                    type: 'function_call_output',
                    call_id: message.tool_call_id,
                    output: stringifyToolOutput(message.content),
                });
            }
            continue;
        }

        input.push(...collectReasoningSignatures(message));

        const content = convertContent(message.content);
        if ((typeof content === 'string' && content.length) || (Array.isArray(content) && content.length)) {
            input.push({
                role: ['system', 'developer', 'user', 'assistant'].includes(role) ? role : 'user',
                content,
            });
        }

        if (role === 'assistant' && Array.isArray(message.tool_calls)) {
            for (const toolCall of message.tool_calls) {
                const fn = toolCall?.function;
                if (!fn?.name || !toolCall?.id) continue;
                input.push({
                    type: 'function_call',
                    call_id: toolCall.id,
                    name: fn.name,
                    arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
                });
            }
        }
    }
    return input;
}

function convertTools(tools, enableWebSearch) {
    const result = [];
    for (const tool of Array.isArray(tools) ? tools : []) {
        if (tool?.type !== 'function' || !tool?.function?.name) continue;
        result.push(compactObject({
            type: 'function',
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters ?? {},
            strict: tool.function.strict,
        }));
    }

    if (enableWebSearch && !result.some(tool => tool.type === 'web_search')) {
        result.push({ type: 'web_search' });
    }
    return result;
}

function convertToolChoice(toolChoice) {
    if (typeof toolChoice === 'string') return toolChoice;
    if (toolChoice?.type === 'function' && toolChoice?.function?.name) {
        return { type: 'function', name: toolChoice.function.name };
    }
    return undefined;
}

export function buildResponsesRequest(body) {
    const options = body?._openai_responses ?? {};
    const reasoningEffort = body?.reasoning_effort && body.reasoning_effort !== 'auto'
        ? ({ min: 'minimal', max: 'high' }[body.reasoning_effort] ?? body.reasoning_effort)
        : undefined;
    const reasoning = (reasoningEffort || body?.include_reasoning)
        ? compactObject({ effort: reasoningEffort, summary: body?.include_reasoning ? 'auto' : undefined })
        : undefined;
    const verbosity = body?.verbosity && body.verbosity !== 'auto' ? body.verbosity : undefined;
    const tools = convertTools(body?.tools, body?.enable_web_search);
    const jsonSchema = body?.json_schema?.value;
    const text = (verbosity || jsonSchema)
        ? compactObject({
            verbosity,
            format: jsonSchema ? compactObject({
                type: 'json_schema',
                name: body.json_schema.name ?? 'response',
                strict: body.json_schema.strict ?? true,
                schema: jsonSchema,
            }) : undefined,
        })
        : undefined;

    return compactObject({
        model: body?.model,
        input: convertMessages(body?.messages),
        stream: Boolean(body?.stream),
        store: Boolean(options.store),
        truncation: options.truncation === 'auto' ? 'auto' : 'disabled',
        include: ['reasoning.encrypted_content'],
        max_output_tokens: numberOrUndefined(body?.max_completion_tokens ?? body?.max_tokens),
        temperature: numberOrUndefined(body?.temperature),
        top_p: numberOrUndefined(body?.top_p),
        reasoning,
        text,
        tools: tools.length ? tools : undefined,
        tool_choice: tools.length ? convertToolChoice(body?.tool_choice) : undefined,
        parallel_tool_calls: tools.some(tool => tool.type === 'function') ? true : undefined,
    });
}

function extractOutputText(output) {
    const text = [];
    for (const item of Array.isArray(output) ? output : []) {
        if (item?.type !== 'message') continue;
        for (const part of Array.isArray(item.content) ? item.content : []) {
            if (part?.type === 'output_text' && typeof part.text === 'string') text.push(part.text);
            if (part?.type === 'refusal' && typeof part.refusal === 'string') text.push(part.refusal);
        }
    }
    return text.join('');
}

function extractReasoningSummary(output) {
    return (Array.isArray(output) ? output : [])
        .filter(item => item?.type === 'reasoning')
        .flatMap(item => Array.isArray(item.summary) ? item.summary : [])
        .map(part => part?.text)
        .filter(text => typeof text === 'string')
        .join('\n\n');
}

function extractToolCalls(output, signature) {
    const calls = (Array.isArray(output) ? output : [])
        .filter(item => item?.type === 'function_call' && item?.call_id && item?.name)
        .map(item => ({
            id: item.call_id,
            type: 'function',
            function: {
                name: item.name,
                arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
            },
        }));

    if (signature && calls.length) calls[0].signature = signature;
    return calls;
}

function convertUsage(usage) {
    if (!usage) return undefined;
    return compactObject({
        prompt_tokens: usage.input_tokens,
        completion_tokens: usage.output_tokens,
        total_tokens: usage.total_tokens,
        prompt_tokens_details: usage.input_tokens_details,
        completion_tokens_details: usage.output_tokens_details,
    });
}

function finishReason(response, toolCalls) {
    if (toolCalls.length) return 'tool_calls';
    if (response?.status === 'incomplete' && response?.incomplete_details?.reason === 'max_output_tokens') return 'length';
    return 'stop';
}

export function convertResponsesResponse(response) {
    const output = Array.isArray(response?.output) ? response.output : [];
    const reasoningItems = output.filter(item => item?.type === 'reasoning');
    const signature = encodeReasoningSignature(reasoningItems);
    const toolCalls = extractToolCalls(output, signature);
    const message = compactObject({
        role: 'assistant',
        content: extractOutputText(output),
        reasoning_content: extractReasoningSummary(output) || undefined,
        tool_calls: toolCalls.length ? toolCalls : undefined,
        reasoning_details: signature && toolCalls.length
            ? [{ type: 'reasoning.encrypted', id: toolCalls[0].id, data: signature }]
            : undefined,
    });

    return compactObject({
        id: response?.id,
        object: 'chat.completion',
        created: response?.created_at ?? Math.floor(Date.now() / 1000),
        model: response?.model,
        choices: [{ index: 0, message, finish_reason: finishReason(response, toolCalls) }],
        usage: convertUsage(response?.usage),
    });
}

export function createStreamState() {
    return {
        id: null,
        created: Math.floor(Date.now() / 1000),
        model: null,
        nextToolIndex: 0,
        toolCalls: new Map(),
        reasoningItems: new Map(),
        finished: false,
    };
}

function chatChunk(state, delta, finish = null, usage = undefined) {
    return compactObject({
        id: state.id,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [{ index: 0, delta, finish_reason: finish }],
        usage,
    });
}

function ensureToolCall(state, item, outputIndex) {
    const itemId = item?.id;
    if (!itemId) return null;
    if (!state.toolCalls.has(itemId)) {
        state.toolCalls.set(itemId, {
            index: state.nextToolIndex++,
            id: item.call_id,
            name: item.name,
            argumentLength: 0,
            outputIndex,
        });
    }
    return state.toolCalls.get(itemId);
}

function captureResponseMetadata(state, response) {
    if (!response) return;
    state.id = response.id ?? state.id;
    state.created = response.created_at ?? state.created;
    state.model = response.model ?? state.model;
}

export function convertResponsesEvent(event, state) {
    const chunks = [];
    if (!event || typeof event !== 'object') return { chunks, done: false };

    captureResponseMetadata(state, event.response);

    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        chunks.push(chatChunk(state, { content: event.delta }));
    } else if (event.type === 'response.reasoning_summary_text.delta' && typeof event.delta === 'string') {
        chunks.push(chatChunk(state, { reasoning_content: event.delta }));
    } else if (event.type === 'response.output_item.added') {
        const item = event.item;
        if (item?.type === 'reasoning' && item.id) state.reasoningItems.set(item.id, item);
        if (item?.type === 'function_call') {
            const call = ensureToolCall(state, item, event.output_index);
            if (call) {
                chunks.push(chatChunk(state, {
                    tool_calls: [{
                        index: call.index,
                        id: call.id,
                        type: 'function',
                        function: { name: call.name, arguments: '' },
                    }],
                }));
            }
        }
    } else if (event.type === 'response.function_call_arguments.delta') {
        const call = state.toolCalls.get(event.item_id);
        if (call && typeof event.delta === 'string') {
            call.argumentLength += event.delta.length;
            chunks.push(chatChunk(state, {
                tool_calls: [{ index: call.index, function: { arguments: event.delta } }],
            }));
        }
    } else if (event.type === 'response.output_item.done') {
        const item = event.item;
        if (item?.type === 'reasoning' && item.id) state.reasoningItems.set(item.id, item);
        if (item?.type === 'function_call') {
            const call = ensureToolCall(state, item, event.output_index);
            if (call && call.argumentLength === 0 && typeof item.arguments === 'string' && item.arguments.length) {
                call.argumentLength = item.arguments.length;
                chunks.push(chatChunk(state, {
                    tool_calls: [{ index: call.index, function: { arguments: item.arguments } }],
                }));
            }
        }
    } else if (['response.completed', 'response.incomplete'].includes(event.type)) {
        const response = event.response ?? {};
        const output = Array.isArray(response.output) ? response.output : [];
        for (const item of output.filter(item => item?.type === 'reasoning' && item?.id)) {
            state.reasoningItems.set(item.id, item);
        }
        for (const item of output.filter(item => item?.type === 'function_call')) {
            ensureToolCall(state, item);
        }

        const signature = encodeReasoningSignature([...state.reasoningItems.values()]);
        const firstCall = [...state.toolCalls.values()].sort((a, b) => a.index - b.index)[0];
        if (signature && firstCall) {
            chunks.push(chatChunk(state, {
                tool_calls: [{ index: firstCall.index, signature }],
            }));
        }

        const reason = finishReason(response, [...state.toolCalls.values()]);
        chunks.push(chatChunk(state, {}, reason, convertUsage(response.usage)));
        state.finished = true;
        return { chunks, done: true };
    } else if (event.type === 'response.failed' || event.type === 'error') {
        const error = event.response?.error ?? event.error ?? event;
        state.finished = true;
        return {
            chunks,
            done: true,
            error: {
                message: error?.message ?? 'OpenAI Responses stream failed.',
                type: error?.type ?? error?.code,
            },
        };
    }

    return { chunks, done: false };
}

export function getResponsesEndpoint(baseUrl) {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Responses API URL must use http or https.');
    }
    const normalizedPath = parsed.pathname.replace(/\/$/, '');
    parsed.pathname = normalizedPath.endsWith('/responses') ? normalizedPath : `${normalizedPath}/responses`;
    parsed.hash = '';
    return parsed.toString();
}
