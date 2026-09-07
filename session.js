export const SESSION_HEADER_NAME = 'x-opencode-session';
export const SESSION_METADATA_KEY = 'opencode_go_session_id';

const VALID_SESSION_ID = /^[A-Za-z0-9._:-]{1,256}$/;

export function isOpenCodeSessionUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;

    try {
        const url = new URL(value);
        const normalizedPath = url.pathname.replace(/\/+$/, '').toLowerCase();
        const isGoPath = normalizedPath === '/zen/go' || normalizedPath.startsWith('/zen/go/');
        const isZenPath = normalizedPath === '/zen/v1' || normalizedPath.startsWith('/zen/v1/');
        return url.protocol === 'https:'
            && url.hostname.toLowerCase() === 'opencode.ai'
            && (isGoPath || isZenPath);
    } catch {
        return false;
    }
}

export function isValidSessionId(value) {
    return typeof value === 'string' && VALID_SESSION_ID.test(value);
}

export function createSessionId(uuidFactory) {
    const raw = String(uuidFactory()).replace(/[^A-Za-z0-9._:-]/g, '');
    return `ses_${raw}`;
}

export function ensureSessionId(metadata, uuidFactory) {
    const existing = metadata?.[SESSION_METADATA_KEY];
    if (isValidSessionId(existing)) {
        return { id: existing, created: false };
    }

    const id = createSessionId(uuidFactory);
    metadata[SESSION_METADATA_KEY] = id;
    return { id, created: true };
}
