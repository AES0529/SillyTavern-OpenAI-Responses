import { validateHeaderName, validateHeaderValue } from 'node:http';

import { parse } from 'yaml';

import {
    isOpenCodeSessionUrl,
    isValidSessionId,
    SESSION_HEADER_NAME,
} from '../session.js';

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BLOCKED_REQUEST_HEADERS = new Set([
    'connection',
    'content-length',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

export class RequestCustomizationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RequestCustomizationError';
    }
}

function parseYaml(value, label) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') return value;

    try {
        return parse(value);
    } catch (error) {
        throw new RequestCustomizationError(`${label}不是有效的 YAML/JSON：${error.message}`);
    }
}

function mappingsFromYaml(value, label) {
    const parsed = parseYaml(value, label);
    if (parsed === undefined || parsed === null) return [];

    const mappings = Array.isArray(parsed) ? parsed : [parsed];
    if (mappings.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
        throw new RequestCustomizationError(`${label}必须是对象，或由对象组成的列表。`);
    }
    return mappings;
}

function safeEntries(mapping, label) {
    const entries = [];
    for (const [key, value] of Object.entries(mapping)) {
        if (UNSAFE_OBJECT_KEYS.has(key)) {
            throw new RequestCustomizationError(`${label}包含不安全的字段名：${key}`);
        }
        entries.push([key, value]);
    }
    return entries;
}

export function applyBodyCustomizations(body, { includeBody, excludeBody } = {}) {
    for (const mapping of mappingsFromYaml(includeBody, '附加请求体')) {
        for (const [key, value] of safeEntries(mapping, '附加请求体')) {
            body[key] = value;
        }
    }

    const excluded = parseYaml(excludeBody, '排除字段');
    let keys = [];
    if (typeof excluded === 'string') {
        keys = [excluded];
    } else if (Array.isArray(excluded)) {
        keys = excluded;
    } else if (excluded && typeof excluded === 'object') {
        keys = Object.keys(excluded);
    } else if (excluded !== undefined && excluded !== null) {
        throw new RequestCustomizationError('排除字段必须是字段名、字段名列表或对象。');
    }

    for (const key of keys) {
        if (typeof key !== 'string') {
            throw new RequestCustomizationError('排除字段列表只能包含字符串。');
        }
        if (!UNSAFE_OBJECT_KEYS.has(key)) delete body[key];
    }
    return body;
}

function setHeader(headers, rawName, rawValue, label = '附加请求头') {
    const name = String(rawName).trim();
    const lowerName = name.toLowerCase();
    if (BLOCKED_REQUEST_HEADERS.has(lowerName)) {
        throw new RequestCustomizationError(`${label}不允许设置 ${name}。`);
    }

    let value = rawValue;
    if (Array.isArray(value)) value = value.map(item => String(item)).join(', ');
    if (value === undefined || value === null) return;
    if (typeof value === 'object') {
        throw new RequestCustomizationError(`${label} ${name} 的值必须是字符串、数字、布尔值或数组。`);
    }
    value = String(value);

    try {
        validateHeaderName(name);
        validateHeaderValue(name, value);
    } catch (error) {
        throw new RequestCustomizationError(`${label} ${name} 无效：${error.message}`);
    }

    for (const existing of Object.keys(headers)) {
        if (existing.toLowerCase() === lowerName) delete headers[existing];
    }
    headers[name] = value;
}

export function buildUpstreamHeaders({ apiKey, includeHeaders, endpoint, sessionId, userAgent }) {
    const headers = {};
    setHeader(headers, 'Content-Type', 'application/json', '内置请求头');
    setHeader(headers, 'User-Agent', userAgent || 'SillyTavern-OpenAI-Responses', '内置请求头');
    if (apiKey) setHeader(headers, 'Authorization', `Bearer ${apiKey}`, '内置请求头');

    for (const mapping of mappingsFromYaml(includeHeaders, '附加请求头')) {
        for (const [name, value] of safeEntries(mapping, '附加请求头')) {
            setHeader(headers, name, value);
        }
    }

    // A client-provided session ID is honored only for the official OpenCode Go
    // or Zen endpoint. The generated per-chat value overrides a stale manual header.
    if (sessionId && isOpenCodeSessionUrl(endpoint)) {
        if (!isValidSessionId(sessionId)) {
            throw new RequestCustomizationError('OpenCode Go 会话 ID 无效。');
        }
        setHeader(headers, SESSION_HEADER_NAME, sessionId, 'OpenCode Go 会话请求头');
    }

    // The body is always JSON even if a custom header used different casing.
    setHeader(headers, 'Content-Type', 'application/json', '内置请求头');
    return headers;
}
