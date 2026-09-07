import assert from 'node:assert/strict';
import test from 'node:test';

import { getNativeRequestOptions, migrateLegacyRequestOptions } from '../request-settings.js';

test('getNativeRequestOptions maps SillyTavern native additional parameter fields', () => {
    assert.deepEqual(getNativeRequestOptions({
        custom_include_body: 'max_tool_calls: 8',
        custom_exclude_body: '- temperature',
        custom_include_headers: 'X-Test: hello',
    }), {
        includeBody: 'max_tool_calls: 8',
        excludeBody: '- temperature',
        includeHeaders: 'X-Test: hello',
    });
});

test('migrateLegacyRequestOptions moves old extension values into empty native fields', () => {
    const extensionSettings = {
        enabled: true,
        includeBody: 'max_tool_calls: 8',
        excludeBody: '- temperature',
        includeHeaders: 'X-Test: hello',
    };
    const oaiSettings = {
        custom_include_body: '',
        custom_exclude_body: '',
        custom_include_headers: '',
    };

    assert.equal(migrateLegacyRequestOptions(extensionSettings, oaiSettings), true);
    assert.equal(oaiSettings.custom_include_body, 'max_tool_calls: 8');
    assert.equal(oaiSettings.custom_exclude_body, '- temperature');
    assert.equal(oaiSettings.custom_include_headers, 'X-Test: hello');
    assert.equal('includeBody' in extensionSettings, false);
    assert.equal('excludeBody' in extensionSettings, false);
    assert.equal('includeHeaders' in extensionSettings, false);
});

test('migrateLegacyRequestOptions preserves existing native values', () => {
    const extensionSettings = { includeHeaders: 'X-Legacy: old' };
    const oaiSettings = { custom_include_headers: 'X-Native: keep' };

    assert.equal(migrateLegacyRequestOptions(extensionSettings, oaiSettings), true);
    assert.equal(oaiSettings.custom_include_headers, 'X-Native: keep');
    assert.equal('includeHeaders' in extensionSettings, false);
});
