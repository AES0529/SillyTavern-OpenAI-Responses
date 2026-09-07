import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    buildResponsesRequest,
    convertResponsesEvent,
    convertResponsesResponse,
    createStreamState,
    getResponsesEndpoint,
} from './adapter.js';
import { buildUpstreamHeaders, RequestCustomizationError } from './custom-options.js';
import { createOutboundProxyController } from './proxy.js';

export const info = {
    id: 'openai-responses',
    name: 'OpenAI Responses',
    description: 'Adds an OpenAI Responses API bridge for SillyTavern.',
};

const OFFICIAL_API_BASE = 'https://api.openai.com/v1';
const PLUGIN_VERSION = '0.5.0';

let outboundFetch;
let outboundProxy;

async function loadSecretApi() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.resolve(here, '../../../src/endpoints/secrets.js'),
        path.resolve(process.cwd(), 'src/endpoints/secrets.js'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return import(pathToFileURL(candidate).href);
    }
    throw new Error('Could not locate SillyTavern src/endpoints/secrets.js. Install this repository directly under SillyTavern/plugins.');
}

async function writeSse(response, payload) {
    if (!response.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)) {
        await once(response, 'drain');
    }
}

async function readSse(stream, onData) {
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of stream) {
        buffer += decoder.decode(chunk, { stream: true });
        buffer = buffer.replaceAll('\r\n', '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = block
                .split('\n')
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trimStart())
                .join('\n');
            if (data) await onData(data);
        }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
        const data = buffer
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n');
        if (data) await onData(data);
    }
}

function parseUpstreamError(text, statusText) {
    try {
        const parsed = JSON.parse(text);
        if (parsed?.error) return parsed;
    } catch {
        // Fall through to a normalized error object.
    }
    return { error: { message: text || statusText || 'OpenAI Responses request failed.' } };
}

async function forwardStream(upstream, response) {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();

    const state = createStreamState();
    let sentDone = false;

    await readSse(upstream.body, async data => {
        if (data === '[DONE]' || sentDone) return;

        let event;
        try {
            event = JSON.parse(data);
        } catch {
            return;
        }

        const converted = convertResponsesEvent(event, state);
        for (const chunk of converted.chunks) await writeSse(response, chunk);
        if (converted.error) await writeSse(response, { error: converted.error });
        if (converted.done) {
            await writeSse(response, '[DONE]');
            sentDone = true;
        }
    });

    if (!sentDone && !response.writableEnded) await writeSse(response, '[DONE]');
    response.end();
}

export async function init(router) {
    const { readSecret, SECRET_KEYS } = await loadSecretApi();
    const { default: nodeFetch } = await import('node-fetch');
    outboundFetch = nodeFetch;
    outboundProxy = await createOutboundProxyController();

    console.info('[OpenAI Responses] Outbound proxy support enabled for SillyTavern requestProxy, proxy environment variables, and Windows system proxy.');

    router.get('/health', (_request, response) => {
        response.send({
            ok: true,
            version: PLUGIN_VERSION,
            proxySupport: outboundProxy.support,
            customRequestOptions: true,
            openCodeSession: true,
        });
    });

    router.post('/generate', async (request, response) => {
        const body = request.body ?? {};
        const usingProxy = Boolean(body.reverse_proxy);
        const apiKey = usingProxy
            ? body.proxy_password
            : readSecret(request.user.directories, SECRET_KEYS.OPENAI, body.secret_id);

        if (!usingProxy && !apiKey) {
            return response.status(400).send({
                error: { message: 'OpenAI API key is missing.' },
            });
        }

        let endpoint;
        try {
            endpoint = getResponsesEndpoint(body.reverse_proxy || OFFICIAL_API_BASE);
        } catch (error) {
            return response.status(400).send({ error: { message: error.message } });
        }

        const controller = new AbortController();
        request.on('aborted', () => controller.abort());
        response.on('close', () => {
            if (!response.writableEnded) controller.abort();
        });

        try {
            const responsesBody = buildResponsesRequest(body);
            const options = body?._openai_responses ?? {};
            const headers = buildUpstreamHeaders({
                apiKey,
                endpoint,
                sessionId: options.sessionId,
                includeHeaders: options.includeHeaders || body?.custom_include_headers,
                userAgent: `SillyTavern-OpenAI-Responses/${PLUGIN_VERSION}`,
            });
            const upstream = await outboundFetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(responsesBody),
                signal: controller.signal,
                agent: outboundProxy.getAgent(),
            });

            if (!upstream.ok) {
                const errorText = await upstream.text();
                return response.status(upstream.status).send(parseUpstreamError(errorText, upstream.statusText));
            }

            if (responsesBody.stream) {
                return await forwardStream(upstream, response);
            }

            const data = await upstream.json();
            if (data?.error) {
                return response.status(500).send({ error: data.error });
            }
            return response.send(convertResponsesResponse(data));
        } catch (error) {
            if (error?.name === 'AbortError') return;
            console.error('[OpenAI Responses] Request failed:', error);
            if (!response.headersSent) {
                const status = error instanceof RequestCustomizationError ? 400 : 500;
                return response.status(status).send({ error: { message: error.message ?? 'OpenAI Responses request failed.' } });
            }
            if (!response.writableEnded) response.end();
        }
    });
}

export async function exit() {
    outboundProxy?.destroy();
    outboundProxy = undefined;
    outboundFetch = undefined;
}
