const LEGACY_TO_NATIVE_FIELDS = Object.freeze([
    ['includeBody', 'custom_include_body'],
    ['excludeBody', 'custom_exclude_body'],
    ['includeHeaders', 'custom_include_headers'],
]);

export function getNativeRequestOptions(oaiSettings) {
    return {
        includeBody: String(oaiSettings?.custom_include_body ?? ''),
        excludeBody: String(oaiSettings?.custom_exclude_body ?? ''),
        includeHeaders: String(oaiSettings?.custom_include_headers ?? ''),
    };
}

export function migrateLegacyRequestOptions(extensionSettings, oaiSettings) {
    let changed = false;

    for (const [legacyKey, nativeKey] of LEGACY_TO_NATIVE_FIELDS) {
        if (!Object.hasOwn(extensionSettings, legacyKey)) continue;

        const legacyValue = String(extensionSettings[legacyKey] ?? '');
        const nativeValue = String(oaiSettings[nativeKey] ?? '');
        if (legacyValue && !nativeValue) oaiSettings[nativeKey] = legacyValue;
        delete extensionSettings[legacyKey];
        changed = true;
    }

    return changed;
}
