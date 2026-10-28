export const isTidalAudioUrl = () => false;

export const getProxyUrl = (url) => {
    if (!url) return url;
    return url;
};

export const wrapTidalUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    return url
        .replace('openapi.tidal.com', 'tidal-proxy.invalid/openapi')
        .replace('api.tidal.com', 'tidal-proxy.invalid/api')
        .replace('https://tidal.com', 'https://tidal-proxy.invalid/tidal');
};
