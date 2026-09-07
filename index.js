import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { oai_settings } from '../../../openai.js';
import { getNativeRequestOptions, migrateLegacyRequestOptions } from './request-settings.js';
import {
    createSessionId,
    ensureSessionId,
    isOpenCodeSessionUrl,
    SESSION_METADATA_KEY,
} from './session.js';

const MODULE_NAME = 'openaiResponses';
const SENTINEL_VALUE = 'openai_responses';
const CORE_SOURCE_VALUE = 'openai';
const GENERATE_ROUTE = '/api/backends/chat-completions/generate';
const PLUGIN_ROUTE = '/api/plugins/openai-responses/generate';
const HEALTH_ROUTE = '/api/plugins/openai-responses/health';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    store: false,
    truncation: 'disabled',
    manualModel: '',
    autoOpenCodeSession: true,
    debugSession: false,
});

let sourceOption;
let originalFetch;
let initializationPromise;
let pageFallbackSessionId = '';
let lastSessionStatus = '等待向 OpenCode Go 发送请求';

function getSettings() {
    extension_settings[MODULE_NAME] ??= { ...DEFAULT_SETTINGS };
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = value;
        }
    }
    return extension_settings[MODULE_NAME];
}

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function randomUuid() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    if (typeof globalThis.crypto?.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getCurrentSessionId() {
    const value = getContext()?.chatMetadata?.[SESSION_METADATA_KEY];
    return typeof value === 'string' ? value : '';
}

function showToast(kind, message) {
    globalThis.toastr?.[kind]?.(message, 'OpenAI Responses');
}

function updateSessionUi() {
    const session = document.getElementById('openai_responses_session_id');
    const status = document.getElementById('openai_responses_session_status');
    if (session) session.textContent = getCurrentSessionId() || '首次请求时自动创建';
    if (status) status.textContent = lastSessionStatus;
}

function prepareOpenCodeSession(generationData, settings) {
    if (!settings.autoOpenCodeSession) {
        lastSessionStatus = '自动会话请求头已关闭';
        return '';
    }
    if (!isOpenCodeSessionUrl(generationData?.reverse_proxy)) {
        lastSessionStatus = '当前反代不是 OpenCode Go / Zen，不发送会话 ID';
        return '';
    }

    const context = getContext();
    const metadataTarget = context?.chatMetadata ?? {
        [SESSION_METADATA_KEY]: pageFallbackSessionId,
    };
    const session = ensureSessionId(metadataTarget, randomUuid);
    if (!context?.chatMetadata) pageFallbackSessionId = session.id;
    if (session.created && context?.chatMetadata) context.saveMetadataDebounced?.();

    lastSessionStatus = '本聊天的会话 ID 已加入请求头';
    if (settings.debugSession) {
        console.info(`[OpenAI Responses] x-opencode-session=${session.id}`);
    }
    return session.id;
}

function isGenerateRequest(input) {
    try {
        const rawUrl = typeof input === 'string' ? input : input?.url;
        return new URL(rawUrl, window.location.origin).pathname === GENERATE_ROUTE;
    } catch {
        return false;
    }
}

function installFetchBridge() {
    if (globalThis.__openaiResponsesFetchBridgeInstalled) return;

    originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async function openaiResponsesFetch(input, init = {}) {
        if (!isGenerateRequest(input) || typeof init?.body !== 'string') {
            return originalFetch(input, init);
        }

        try {
            const body = JSON.parse(init.body);
            if (!body?._openai_responses) {
                return originalFetch(input, init);
            }

            return originalFetch(PLUGIN_ROUTE, {
                ...init,
                body: JSON.stringify(body),
            });
        } catch (error) {
            console.error('[OpenAI Responses] Failed to redirect generation request.', error);
            return originalFetch(input, init);
        }
    };

    globalThis.__openaiResponsesFetchBridgeInstalled = true;
}

function tagUnsupportedControls() {
    const selectors = [
        '#n_openai',
        '#freq_pen_openai',
        '#pres_pen_openai',
        '#seed_openai',
        '#logit_bias_openai',
        '#openai_request_images',
        '#openai_show_thoughts',
    ];

    for (const selector of selectors) {
        const element = document.querySelector(selector);
        const container = element?.closest('.range-block') ?? element?.parentElement;
        container?.classList.add('openai-responses-unsupported');
    }
}

function updateActiveUi() {
    const enabled = Boolean(getSettings().enabled);
    document.body.classList.toggle('openai-responses-active', enabled);
    document.getElementById('openai_responses_active_note')?.classList.toggle('displayNone', !enabled);

    if (enabled && sourceOption) {
        sourceOption.value = CORE_SOURCE_VALUE;
        sourceOption.selected = true;
    }
    updateSessionUi();
}

async function checkServerPlugin() {
    if (!getSettings().enabled) return;

    try {
        const response = await originalFetch(HEALTH_ROUTE, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        console.warn('[OpenAI Responses] Server plugin is unavailable.', error);
        toastr.error(
            '请启用并安装配套的 server plugin，然后重启 SillyTavern。',
            'OpenAI Responses 服务端未加载',
            { preventDuplicates: true, timeOut: 10000 },
        );
    }
}

function setEnabled(enabled) {
    const settings = getSettings();
    if (settings.enabled === enabled) return;

    settings.enabled = enabled;
    saveSettingsDebounced();
    updateActiveUi();

    if (enabled) {
        queueMicrotask(checkServerPlugin);
    }
}

function onSourceChangeCapture(event) {
    const select = event.currentTarget;
    const selected = select.selectedOptions?.[0];
    const selectedResponses = selected?.dataset?.openaiResponses === 'true';

    if (selectedResponses) {
        // SillyTavern continues to use its mature OpenAI model/key/settings path.
        // The extension marker redirects only the final generation request.
        selected.value = CORE_SOURCE_VALUE;
        setEnabled(true);
    } else {
        if (sourceOption) sourceOption.value = SENTINEL_VALUE;
        setEnabled(false);
    }
}

function installSourceOption() {
    const select = document.getElementById('chat_completion_source');
    if (!(select instanceof HTMLSelectElement)) {
        throw new Error('Chat Completion Source selector was not found.');
    }

    const existingOption = [...select.options].find(option => option.dataset.openaiResponses === 'true');
    if (existingOption) {
        sourceOption = existingOption;
        sourceOption.value = getSettings().enabled ? CORE_SOURCE_VALUE : SENTINEL_VALUE;
        return;
    }

    sourceOption = document.createElement('option');
    sourceOption.textContent = 'OpenAI Responses';
    sourceOption.value = getSettings().enabled ? CORE_SOURCE_VALUE : SENTINEL_VALUE;
    sourceOption.dataset.openaiResponses = 'true';

    // Insert before the regular OpenAI option. Programmatic .val('openai') calls
    // made by SillyTavern will then settle on the regular OpenAI option.
    const regularOpenAi = [...select.options].find(option => option.value === CORE_SOURCE_VALUE);
    regularOpenAi?.before(sourceOption);
    if (!regularOpenAi) select.prepend(sourceOption);

    select.addEventListener('change', onSourceChangeCapture, true);
}

function installConnectionNote() {
    const select = document.getElementById('chat_completion_source');
    if (!select || document.getElementById('openai_responses_active_note')) return;

    const note = document.createElement('div');
    note.id = 'openai_responses_active_note';
    note.className = 'openai-responses-note displayNone';
    note.innerHTML = '<strong>Responses API 已启用。</strong> 密钥、模型列表和反代继续使用下方的 OpenAI 配置；生成请求将发送到 <code>/responses</code>。';
    select.insertAdjacentElement('afterend', note);
}

function applyManualModel() {
    const input = document.getElementById('openai_responses_manual_model');
    const model = String(input?.value ?? '').trim();
    if (!model) {
        toastr.warning('请输入模型 ID。', 'OpenAI Responses');
        return;
    }

    const modelSelect = document.getElementById('model_openai_select');
    if (!(modelSelect instanceof HTMLSelectElement)) return;

    let option = [...modelSelect.options].find(item => item.value === model);
    if (!option) {
        option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        option.dataset.openaiResponsesManual = 'true';
        modelSelect.append(option);
    }

    option.selected = true;
    modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
    getSettings().manualModel = model;
    saveSettingsDebounced();
    toastr.success(`已选择 ${model}`, 'OpenAI Responses');
}

function installSettingsPanel() {
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!host || document.getElementById('openai_responses_settings')) return;

    const settings = getSettings();
    const panel = document.createElement('div');
    panel.id = 'openai_responses_settings';
    panel.className = 'extension_container openai-responses-settings';
    panel.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>OpenAI Responses</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input id="openai_responses_store" type="checkbox" ${settings.store ? 'checked' : ''}>
                    <span>允许 OpenAI 存储 Response（默认关闭）</span>
                </label>
                <label for="openai_responses_truncation">超长上下文处理</label>
                <select id="openai_responses_truncation" class="text_pole">
                    <option value="disabled" ${settings.truncation === 'disabled' ? 'selected' : ''}>报错，不自动截断</option>
                    <option value="auto" ${settings.truncation === 'auto' ? 'selected' : ''}>自动截断最早内容</option>
                </select>
                <label for="openai_responses_manual_model">手动模型 ID（用于未出现在模型列表中的模型）</label>
                <div class="flex-container">
                    <input id="openai_responses_manual_model" class="text_pole flex1" type="text" value="${String(settings.manualModel).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}" placeholder="例如 gpt-5.4">
                    <button id="openai_responses_apply_model" class="menu_button">应用</button>
                </div>
                <hr>
                <b>OpenCode Go</b>
                <label class="checkbox_label">
                    <input id="openai_responses_auto_session" type="checkbox" ${settings.autoOpenCodeSession ? 'checked' : ''}>
                    <span>仅对 OpenCode Go / Zen 官方地址自动添加 x-opencode-session</span>
                </label>
                <div class="openai-responses-session-row">
                    <span>当前聊天 ID</span>
                    <code id="openai_responses_session_id">首次请求时自动创建</code>
                </div>
                <div class="flex-container">
                    <button id="openai_responses_copy_session" type="button" class="menu_button">复制 ID</button>
                    <button id="openai_responses_rotate_session" type="button" class="menu_button">为本聊天换一个 ID</button>
                </div>
                <div class="openai-responses-session-row">
                    <span>最近状态</span>
                    <span id="openai_responses_session_status"></span>
                </div>
                <label class="checkbox_label">
                    <input id="openai_responses_debug_session" type="checkbox" ${settings.debugSession ? 'checked' : ''}>
                    <span>在浏览器控制台记录会话请求头（仅排查问题时开启）</span>
                </label>
                <small>附加请求体、排除字段和附加请求头请直接使用“API 连接”中连接按钮旁的“Additional Parameters / 附加参数”。</small>
                <small>函数调用、流式输出、图片输入、JSON Schema、推理强度、verbosity 和 Web Search 会自动转换。</small>
            </div>
        </div>`;
    host.append(panel);

    panel.querySelector('#openai_responses_store')?.addEventListener('change', event => {
        settings.store = Boolean(event.currentTarget.checked);
        saveSettingsDebounced();
    });
    panel.querySelector('#openai_responses_truncation')?.addEventListener('change', event => {
        settings.truncation = String(event.currentTarget.value);
        saveSettingsDebounced();
    });
    panel.querySelector('#openai_responses_apply_model')?.addEventListener('click', applyManualModel);
    panel.querySelector('#openai_responses_auto_session')?.addEventListener('change', event => {
        settings.autoOpenCodeSession = Boolean(event.currentTarget.checked);
        lastSessionStatus = settings.autoOpenCodeSession
            ? '等待向 OpenCode Go 发送请求'
            : '自动会话请求头已关闭';
        saveSettingsDebounced();
        updateSessionUi();
    });
    panel.querySelector('#openai_responses_debug_session')?.addEventListener('change', event => {
        settings.debugSession = Boolean(event.currentTarget.checked);
        saveSettingsDebounced();
    });
    panel.querySelector('#openai_responses_copy_session')?.addEventListener('click', async () => {
        const id = getCurrentSessionId();
        if (!id) return showToast('warning', '当前聊天还没有会话 ID，请先发送一条消息。');
        try {
            await navigator.clipboard.writeText(id);
            showToast('success', '会话 ID 已复制。');
        } catch {
            showToast('error', '复制失败，请手动选择上方 ID。');
        }
    });
    panel.querySelector('#openai_responses_rotate_session')?.addEventListener('click', () => {
        const context = getContext();
        if (!context?.chatMetadata) return showToast('warning', '请先打开一个聊天。');
        context.chatMetadata[SESSION_METADATA_KEY] = createSessionId(randomUuid);
        context.saveMetadataDebounced?.();
        lastSessionStatus = '已为本聊天生成新的会话 ID';
        updateSessionUi();
        showToast('success', '已为本聊天更换会话 ID。');
    });
    updateSessionUi();
}

function onGenerationSettingsReady(generationData) {
    const settings = getSettings();
    if (!settings.enabled || oai_settings.chat_completion_source !== CORE_SOURCE_VALUE) return;
    const requestOptions = getNativeRequestOptions(oai_settings);

    generationData._openai_responses = {
        store: Boolean(settings.store),
        truncation: settings.truncation === 'auto' ? 'auto' : 'disabled',
        ...requestOptions,
    };

    const sessionId = prepareOpenCodeSession(generationData, settings);
    if (sessionId) generationData._openai_responses.sessionId = sessionId;
    updateSessionUi();

    // Responses has one candidate per request. SillyTavern will still provide
    // normal swiping/regeneration, but not multi-swipe in a single request.
    delete generationData.n;
}

async function waitForDocumentReady() {
    if (document.readyState !== 'loading') return;
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
}

async function initialize() {
    await waitForDocumentReady();
    const settings = getSettings();
    if (migrateLegacyRequestOptions(settings, oai_settings)) saveSettingsDebounced();
    installFetchBridge();
    installSourceOption();
    installConnectionNote();
    installSettingsPanel();
    tagUnsupportedControls();
    eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, onGenerationSettingsReady);
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            lastSessionStatus = '等待向 OpenCode Go 发送请求';
            updateSessionUi();
        });
    }
    updateActiveUi();

    if (getSettings().enabled) {
        await checkServerPlugin();
    }
}

export function init() {
    if (!initializationPromise) {
        initializationPromise = initialize().catch(error => {
            initializationPromise = undefined;
            throw error;
        });
    }
    return initializationPromise;
}

// SillyTavern 1.17+ calls the manifest activate hook. Versions 1.14-1.16 only
// import the module, so they need this side-effect bootstrap. init() is
// intentionally idempotent to make both startup paths safe.
void init().catch(error => console.error('[OpenAI Responses] Failed to initialize extension.', error));
