export const isTidalAudioUrl = () => false;

export const getProxyUrl = (url) => {
    if (!url) return url;
    return url;
};

export const wrapTidalUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    return url
        .replace('openapi.tidal.com', 'tidal-proxy.spotifree2.netlify.app/openapi')
        .replace('api.tidal.com', 'tidal-proxy.spotifree2.netlify.app/api')
        .replace('https://tidal.com', 'https://tidal-proxy.spotifree2.netlify.app/tidal');
};
