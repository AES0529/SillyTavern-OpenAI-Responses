import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createOutboundProxyController,
    getWindowsProxyForUrl,
    hasProxyEnvironment,
    parseWindowsProxyRegistry,
} from '../server/proxy.js';

test('parseWindowsProxyRegistry reads a typical Clash system proxy', () => {
    const settings = parseWindowsProxyRegistry(`
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7897
    ProxyOverride    REG_SZ    localhost;127.*;192.168.*;<local>
`);

    assert.equal(settings.enabled, true);
    assert.deepEqual(settings.proxies, { all: 'http://127.0.0.1:7897' });
    assert.deepEqual(settings.bypass, ['localhost', '127.*', '192.168.*', '<local>']);
});

test('getWindowsProxyForUrl selects per-protocol proxies and honors bypass rules', () => {
    const settings = parseWindowsProxyRegistry(`
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    http=127.0.0.1:8080;https=127.0.0.1:8443;socks=127.0.0.1:1080
    ProxyOverride    REG_SZ    localhost;127.*;*.lan;<local>
`);

    assert.equal(getWindowsProxyForUrl('https://api.example.com/v1/responses', settings), 'http://127.0.0.1:8443');
    assert.equal(getWindowsProxyForUrl('http://api.example.com/models', settings), 'http://127.0.0.1:8080');
    assert.equal(getWindowsProxyForUrl('http://127.0.0.1:5000/v1', settings), '');
    assert.equal(getWindowsProxyForUrl('https://router.lan/api', settings), '');
    assert.equal(getWindowsProxyForUrl('https://intranet/api', settings), '');
});

test('getWindowsProxyForUrl supports Windows PAC URLs', () => {
    const settings = parseWindowsProxyRegistry(`
    ProxyEnable    REG_DWORD    0x0
    AutoConfigURL    REG_SZ    http://127.0.0.1:9000/proxy.pac
`);

    assert.equal(getWindowsProxyForUrl('https://api.example.com', settings), 'pac+http://127.0.0.1:9000/proxy.pac');
});

test('hasProxyEnvironment recognizes SillyTavern and standard proxy variables', () => {
    assert.equal(hasProxyEnvironment({ all_proxy: 'socks5://127.0.0.1:1080' }), true);
    assert.equal(hasProxyEnvironment({ HTTPS_PROXY: 'http://127.0.0.1:8080' }), true);
    assert.equal(hasProxyEnvironment({ HTTPS_PROXY: '   ' }), false);
    assert.equal(hasProxyEnvironment({}), false);
});

test('createOutboundProxyController switches between environment and Windows system proxy', async () => {
    const instances = [];
    class FakeProxyAgent {
        constructor(options) {
            this.options = options;
            instances.push(this);
        }
        destroy() {}
    }

    const environment = {};
    const controller = await createOutboundProxyController({
        platform: 'win32',
        environment,
        ProxyAgentClass: FakeProxyAgent,
        windowsProxyQuery: async () => ({
            enabled: true,
            proxies: { all: 'http://127.0.0.1:7897' },
            bypass: [],
            autoConfigUrl: '',
        }),
    });

    assert.equal(instances.length, 2);
    assert.equal(controller.getAgent(), instances[1]);
    assert.equal(await instances[1].options.getProxyForUrl('https://api.example.com'), 'http://127.0.0.1:7897');

    environment.ALL_PROXY = 'http://127.0.0.1:8080';
    assert.equal(controller.getAgent(), instances[0]);
    controller.destroy();
});
