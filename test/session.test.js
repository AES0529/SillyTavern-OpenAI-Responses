import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ensureSessionId,
    isOpenCodeSessionUrl,
    SESSION_METADATA_KEY,
} from '../session.js';

const uuid = () => '11111111-2222-4333-8444-555555555555';

test('recognizes only the official OpenCode Go and Zen HTTPS endpoint families', () => {
    assert.equal(isOpenCodeSessionUrl('https://opencode.ai/zen/go/v1'), true);
    assert.equal(isOpenCodeSessionUrl('https://opencode.ai/zen/go/v1/responses'), true);
    assert.equal(isOpenCodeSessionUrl('https://opencode.ai/zen/v1'), true);
    assert.equal(isOpenCodeSessionUrl('https://opencode.ai/zen/v1/'), true);
    assert.equal(isOpenCodeSessionUrl('https://opencode.ai/zen/v1/responses'), true);
    assert.equal(isOpenCodeSessionUrl('https://opencode.ai/zen'), false);
    assert.equal(isOpenCodeSessionUrl('https://opencode.ai/other/v1/responses'), false);
    assert.equal(isOpenCodeSessionUrl('http://opencode.ai/zen/v1/responses'), false);
    assert.equal(isOpenCodeSessionUrl('https://opencode.ai.evil.example/zen/v1/responses'), false);
});

test('creates one session ID and reuses it for the same chat metadata', () => {
    const metadata = {};
    const first = ensureSessionId(metadata, uuid);
    const second = ensureSessionId(metadata, () => 'different');

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.id, 'ses_11111111-2222-4333-8444-555555555555');
    assert.equal(second.id, first.id);
    assert.equal(metadata[SESSION_METADATA_KEY], first.id);
});
