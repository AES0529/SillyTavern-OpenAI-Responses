import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WINDOWS_INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const PROXY_ENV_KEYS = [
    'ALL_PROXY',
    'all_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'npm_config_proxy',
    'npm_config_https_proxy',
];

export function hasProxyEnvironment(environment = process.env) {
    return PROXY_ENV_KEYS.some(key => typeof environment[key] === 'string' && environment[key].trim().length > 0);
}

function normalizeProxyUrl(value, scheme = 'http') {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
    return `${scheme}://${trimmed}`;
}

function parseProxyServer(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return {};

    if (!trimmed.includes('=')) {
        return { all: normalizeProxyUrl(trimmed) };
    }

    const proxies = {};
    for (const entry of trimmed.split(';')) {
        const separator = entry.indexOf('=');
        if (separator < 1) continue;
        const key = entry.slice(0, separator).trim().toLowerCase();
        const proxy = entry.slice(separator + 1).trim();
        if (!proxy) continue;

        if (key.startsWith('socks')) {
            proxies.socks = normalizeProxyUrl(proxy, 'socks');
        } else if (key === 'http' || key === 'https') {
            // Windows names the destination protocol here. The local proxy
            // itself is normally an HTTP CONNECT proxy unless it has a scheme.
            proxies[key] = normalizeProxyUrl(proxy, 'http');
        }
    }
    return proxies;
}

export function parseWindowsProxyRegistry(output) {
    const values = {};
    for (const line of String(output ?? '').split(/\r?\n/)) {
        const match = line.match(/^\s*(ProxyEnable|ProxyServer|ProxyOverride|AutoConfigURL)\s+REG_[A-Z0-9_]+\s+(.*?)\s*$/i);
        if (match) values[match[1].toLowerCase()] = match[2];
    }

    const proxyEnable = values.proxyenable;
    const enabled = proxyEnable === '1' || proxyEnable?.toLowerCase() === '0x1';
    return {
        enabled,
        proxies: parseProxyServer(values.proxyserver),
        bypass: String(values.proxyoverride ?? '')
            .split(';')
            .map(value => value.trim())
            .filter(Boolean),
        autoConfigUrl: String(values.autoconfigurl ?? '').trim(),
    };
}

function wildcardToRegExp(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
    return new RegExp(`^${escaped}$`, 'i');
}

function shouldBypassProxy(url, bypass) {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const hostWithPort = parsed.port ? `${hostname}:${parsed.port}` : hostname;

    if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return true;

    for (const rawPattern of Array.isArray(bypass) ? bypass : []) {
        const pattern = rawPattern.trim().toLowerCase();
        if (!pattern) continue;
        if (pattern === '*') return true;
        if (pattern === '<local>' && !hostname.includes('.')) return true;
        if (pattern === '<-loopback>') continue;

        const normalized = pattern.includes('://')
            ? (() => {
                try {
                    const value = new URL(pattern);
                    return value.port ? `${value.hostname}:${value.port}` : value.hostname;
                } catch {
                    return pattern;
                }
            })()
            : pattern;

        if (wildcardToRegExp(normalized).test(hostname) || wildcardToRegExp(normalized).test(hostWithPort)) {
            return true;
        }
    }
    return false;
}

function toPacProxyUrl(value) {
    const url = String(value ?? '').trim();
    if (!url) return '';
    if (url.startsWith('pac+')) return url;
    if (/^(data|file|ftp|http|https):/i.test(url)) return `pac+${url}`;
    return '';
}

export function getWindowsProxyForUrl(url, settings) {
    if (!settings || shouldBypassProxy(url, settings.bypass)) return '';

    const pacProxy = toPacProxyUrl(settings.autoConfigUrl);
    if (pacProxy) return pacProxy;
    if (!settings.enabled) return '';

    const protocol = new URL(url).protocol;
    const proxies = settings.proxies ?? {};
    if (protocol === 'https:') return proxies.https || proxies.http || proxies.all || proxies.socks || '';
    if (protocol === 'http:') return proxies.http || proxies.all || proxies.socks || '';
    return proxies.all || proxies.socks || '';
}

async function queryWindowsProxyRegistry() {
    const { stdout } = await execFileAsync('reg.exe', ['query', WINDOWS_INTERNET_SETTINGS], {
        encoding: 'utf8',
        windowsHide: true,
    });
    return parseWindowsProxyRegistry(stdout);
}

function createWindowsProxyResolver({ query = queryWindowsProxyRegistry, cacheMs = 5000 } = {}) {
    let cachedSettings = null;
    let checkedAt = 0;

    return async url => {
        const now = Date.now();
        if (!cachedSettings || now - checkedAt >= cacheMs) {
            try {
                cachedSettings = await query();
            } catch {
                cachedSettings = { enabled: false, proxies: {}, bypass: [], autoConfigUrl: '' };
            }
            checkedAt = now;
        }
        return getWindowsProxyForUrl(url, cachedSettings);
    };
}

export async function createOutboundProxyController({
    platform = process.platform,
    environment = process.env,
    ProxyAgentClass,
    windowsProxyQuery,
} = {}) {
    const AgentClass = ProxyAgentClass ?? (await import('proxy-agent')).ProxyAgent;
    const environmentAgent = new AgentClass({ keepAlive: true });
    const windowsAgent = platform === 'win32'
        ? new AgentClass({
            keepAlive: true,
            getProxyForUrl: createWindowsProxyResolver({ query: windowsProxyQuery }),
        })
        : null;

    return {
        getAgent() {
            if (hasProxyEnvironment(environment)) return environmentAgent;
            return windowsAgent ?? undefined;
        },
        support: {
            environment: true,
            sillyTavernRequestProxy: true,
            windowsSystemProxy: platform === 'win32',
        },
        destroy() {
            environmentAgent.destroy?.();
            windowsAgent?.destroy?.();
        },
    };
}
