import assert from 'node:assert/strict';
import test from 'node:test';

import {
    applyBodyCustomizations,
    buildUpstreamHeaders,
    RequestCustomizationError,
} from '../server/custom-options.js';

function lowerCaseHeaders(headers) {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

test('applyBodyCustomizations accepts YAML mappings and excludes named fields', () => {
    const body = { model: 'old', temperature: 1, include: ['reasoning.encrypted_content'] };
    applyBodyCustomizations(body, {
        includeBody: '- model: muse-spark-1.3-contributor\n- vendor_option: true',
        excludeBody: 'temperature',
    });

    assert.deepEqual(body, {
        model: 'muse-spark-1.3-contributor',
        include: ['reasoning.encrypted_content'],
        vendor_option: true,
    });
});

test('buildUpstreamHeaders keeps custom headers and enforces the per-chat OpenCode Go session', () => {
    const headers = lowerCaseHeaders(buildUpstreamHeaders({
        apiKey: 'secret',
        endpoint: 'https://opencode.ai/zen/go/v1/responses',
        sessionId: 'ses_fixed-chat-id',
        includeHeaders: 'X-Test: hello\nX-OpenCode-Session: stale\nUser-Agent: My-SillyTavern/1.0',
        userAgent: 'SillyTavern-OpenAI-Responses/0.4.1',
    }));

    assert.equal(headers.authorization, 'Bearer secret');
    assert.equal(headers['content-type'], 'application/json');
    assert.equal(headers['user-agent'], 'My-SillyTavern/1.0');
    assert.equal(headers['x-test'], 'hello');
    assert.equal(headers['x-opencode-session'], 'ses_fixed-chat-id');
});

test('buildUpstreamHeaders does not leak an automatic session ID to another host', () => {
    const headers = lowerCaseHeaders(buildUpstreamHeaders({
        endpoint: 'https://example.com/v1/responses',
        sessionId: 'ses_fixed-chat-id',
    }));
    assert.equal('x-opencode-session' in headers, false);
});

test('buildUpstreamHeaders adds the session ID to OpenCode Zen with or without /responses', () => {
    for (const endpoint of [
        'https://opencode.ai/zen/v1',
        'https://opencode.ai/zen/v1/',
        'https://opencode.ai/zen/v1/responses',
    ]) {
        const headers = lowerCaseHeaders(buildUpstreamHeaders({
            endpoint,
            sessionId: 'ses_fixed-chat-id',
        }));
        assert.equal(headers['x-opencode-session'], 'ses_fixed-chat-id');
    }
});

test('custom request options reject malformed YAML and transport-controlled headers', () => {
    assert.throws(
        () => applyBodyCustomizations({}, { includeBody: 'broken: [yaml' }),
        RequestCustomizationError,
    );
    assert.throws(
        () => buildUpstreamHeaders({ endpoint: 'https://example.com', includeHeaders: 'Content-Length: 12' }),
        /不允许设置 Content-Length/,
    );
});
