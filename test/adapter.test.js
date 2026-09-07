import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildResponsesRequest,
    convertMessages,
    convertResponsesEvent,
    convertResponsesResponse,
    createStreamState,
    decodeReasoningSignature,
    encodeReasoningSignature,
    getResponsesEndpoint,
} from '../server/adapter.js';

test('buildResponsesRequest maps text, images, tools and Responses parameters', () => {
    const result = buildResponsesRequest({
        model: 'gpt-test',
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: 'Describe this' },
                { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==', detail: 'high' } },
            ],
        }],
        stream: true,
        max_tokens: 123,
        temperature: 0.7,
        top_p: 0.9,
        reasoning_effort: 'high',
        include_reasoning: true,
        verbosity: 'low',
        enable_web_search: true,
        tools: [{ type: 'function', function: { name: 'roll', description: 'Roll dice', parameters: { type: 'object' } } }],
        tool_choice: 'auto',
        _openai_responses: { store: false, truncation: 'auto' },
    });

    assert.equal(result.model, 'gpt-test');
    assert.equal(result.max_output_tokens, 123);
    assert.deepEqual(result.reasoning, { effort: 'high', summary: 'auto' });
    assert.deepEqual(result.text, { verbosity: 'low' });
    assert.equal(result.input[0].content[1].type, 'input_image');
    assert.deepEqual(result.tools.map(tool => tool.type), ['function', 'web_search']);
    assert.deepEqual(result.include, ['reasoning.encrypted_content']);
    assert.equal(result.store, false);
    assert.equal(result.truncation, 'auto');
    assert.equal('messages' in result, false);
    assert.equal('stop' in result, false);
});

test('buildResponsesRequest applies additional and excluded body fields', () => {
    const result = buildResponsesRequest({
        model: 'muse-spark-1.3-contributor',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
        temperature: 0.7,
        _openai_responses: {
            includeBody: 'temperature: 0.25\nmax_tool_calls: 8\nmetadata:\n  client: SillyTavern',
            excludeBody: '- include\n- stream',
        },
    });

    assert.equal(result.temperature, 0.25);
    assert.equal(result.max_tool_calls, 8);
    assert.deepEqual(result.metadata, { client: 'SillyTavern' });
    assert.equal('include' in result, false);
    assert.equal('stream' in result, false);
});

test('convertMessages preserves stateless reasoning and function call output', () => {
    const reasoning = [{ type: 'reasoning', id: 'rs_1', encrypted_content: 'encrypted', summary: [] }];
    const signature = encodeReasoningSignature(reasoning);
    const result = convertMessages([
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', signature, function: { name: 'lookup', arguments: '{"id":1}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: '{"name":"Ada"}' },
    ]);

    assert.deepEqual(result[0], reasoning[0]);
    assert.equal(result[1].type, 'function_call');
    assert.equal(result[2].type, 'function_call_output');
    assert.deepEqual(decodeReasoningSignature(signature), reasoning);
});

test('convertResponsesResponse maps text, reasoning, tools and usage', () => {
    const result = convertResponsesResponse({
        id: 'resp_1',
        created_at: 10,
        model: 'gpt-test',
        status: 'completed',
        output: [
            { type: 'reasoning', id: 'rs_1', encrypted_content: 'encrypted', summary: [{ type: 'summary_text', text: 'Checked.' }] },
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello', annotations: [] }] },
            { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"id":1}' },
        ],
        usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
    });

    const message = result.choices[0].message;
    assert.equal(message.content, 'Hello');
    assert.equal(message.reasoning_content, 'Checked.');
    assert.equal(message.tool_calls[0].function.name, 'lookup');
    assert.match(message.tool_calls[0].signature, /^st-openai-responses-v1:/);
    assert.equal(result.choices[0].finish_reason, 'tool_calls');
    assert.equal(result.usage.total_tokens, 12);
});

test('convertResponsesEvent produces Chat Completions-compatible streaming chunks', () => {
    const state = createStreamState();
    convertResponsesEvent({ type: 'response.created', response: { id: 'resp_1', created_at: 10, model: 'gpt-test' } }, state);
    const text = convertResponsesEvent({ type: 'response.output_text.delta', delta: 'Hi' }, state);
    assert.equal(text.chunks[0].choices[0].delta.content, 'Hi');

    const added = convertResponsesEvent({
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '' },
    }, state);
    assert.equal(added.chunks[0].choices[0].delta.tool_calls[0].id, 'call_1');

    const args = convertResponsesEvent({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"id":1}' }, state);
    assert.equal(args.chunks[0].choices[0].delta.tool_calls[0].function.arguments, '{"id":1}');

    const completed = convertResponsesEvent({
        type: 'response.completed',
        response: {
            id: 'resp_1',
            model: 'gpt-test',
            status: 'completed',
            output: [
                { type: 'reasoning', id: 'rs_1', encrypted_content: 'encrypted', summary: [] },
                { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"id":1}' },
            ],
            usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
        },
    }, state);

    assert.equal(completed.done, true);
    assert.match(completed.chunks[0].choices[0].delta.tool_calls[0].signature, /^st-openai-responses-v1:/);
    assert.equal(completed.chunks.at(-1).choices[0].finish_reason, 'tool_calls');
});

test('getResponsesEndpoint keeps an API base path and validates the protocol', () => {
    assert.equal(getResponsesEndpoint('https://api.openai.com/v1'), 'https://api.openai.com/v1/responses');
    assert.equal(getResponsesEndpoint('http://localhost:1234/v1/'), 'http://localhost:1234/v1/responses');
    assert.equal(getResponsesEndpoint('http://localhost:1234/v1/responses'), 'http://localhost:1234/v1/responses');
    assert.throws(() => getResponsesEndpoint('file:///tmp'), /http or https/);
});
