import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import authGatePlugin from './vite-plugin-auth-gate.js';
import blobAssetPlugin from './vite-plugin-blob.js';
import svgUse from './vite-plugin-svg-use.js';
import uploadPlugin from './vite-plugin-upload.js';
import { playwright } from '@vitest/browser-playwright';
import { execSync } from 'child_process';

// Em desenvolvimento, serve as funções da pasta api/ (em produção elas rodam na Vercel).
function proxyAudioPlugin() {
    const functions = {
        '/api/spotify-playlist': '/api/spotify-playlist.js',
    };
    return {
        name: 'proxy-audio-dev',
        configureServer(server) {
            for (const [route, file] of Object.entries(functions)) {
                server.middlewares.use(route, async (req, res) => {
                    try {
                        const mod = await server.ssrLoadModule(file);
                        const handler = mod[req.method || 'GET'];
                        if (!handler) {
                            res.statusCode = 405;
                            return res.end();
                        }
                        const request = new Request(new URL(req.originalUrl || req.url || '', 'http://localhost'));
                        const response = await handler(request);
                        res.statusCode = response.status;
                        response.headers.forEach((v, k) => res.setHeader(k, v));
                        res.end(Buffer.from(await response.arrayBuffer()));
                    } catch (e) {
                        res.statusCode = 500;
                        res.end(JSON.stringify({ error: String(e.message || e) }));
                    }
                });
            }
        },
    };
}

function getGitCommitHash() {
    try {
        return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
        return 'unknown';
    }
}

export default defineConfig(({ mode }) => {
    const commitHash = getGitCommitHash();
    const isDev = mode === 'development';

    return {
        test: {
            // https://vitest.dev/guide/browser/
            browser: {
                enabled: true,
                provider: playwright({
                    launchOptions: {
                        args: ['--disable-web-security'],
                    },
                }),
                headless: !!process.env.HEADLESS,
                instances: [{ browser: 'chromium' }],
            },
        },
        base: './',
        define: {
            __COMMIT_HASH__: JSON.stringify(commitHash),
            __VITEST__: !!process.env.VITEST,
            'process.env.CI': JSON.stringify(process.env.CI ?? ''),
        },
        worker: {
            format: 'es',
        },
        resolve: {
            alias: {
                '!lucide': '/node_modules/lucide-static/icons',
                '!simpleicons': '/node_modules/simple-icons/icons',
                '!': '/node_modules',

                events: '/node_modules/events/events.js',
                pocketbase: '/node_modules/pocketbase/dist/pocketbase.es.js',
                stream: path.resolve(__dirname, 'stream-stub.js'), // Stub for stream module
                // Preact aliases for React-based i18n libs
                react: 'preact/compat',
                'react-dom': 'preact/compat',
                'react/jsx-runtime': 'preact/jsx-runtime',
            },
        },
        optimizeDeps: {
            exclude: ['pocketbase', '@ffmpeg/ffmpeg', '@ffmpeg/util'],
            include: ['workbox-window', '@capacitor/haptics', 'fuse.js'],
        },
        server: {
            proxy: {
                '/api/tracks': {
                    target: 'https://tracks.monochrome.st',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/api\/tracks/, ''),
                    secure: true,
                },
            },
            fs: {
                allow: ['.', 'node_modules'],
                // host: true,
                // allowedHosts: ['<your_tailscale_hostname>'], // e.g. pi5.tailf5f622.ts.net
            },
        },
        // preview: {
        //     host: true,
        //     allowedHosts: ['<your_tailscale_hostname>'], // e.g. pi5.tailf5f622.ts.net
        // },
        build: {
            outDir: 'dist',
            emptyOutDir: true,
            sourcemap: false,
            minify: 'esbuild',
            reportCompressedSize: false,
            rollupOptions: {
                treeshake: true,
            },
        },
        plugins: [
            proxyAudioPlugin(),
            authGatePlugin(),
            uploadPlugin(),
            blobAssetPlugin(),
            svgUse(),
            VitePWA({
                registerType: 'autoUpdate',
                devOptions: {
                    enabled: true,
                    type: 'classic',
                    disableRuntimeConfig: true,
                    suppressWarnings: true,
                },
                workbox: {
                    skipWaiting: true,
                    clientsClaim: true,
                    globPatterns: ['index.html', 'manifest.json'],
                    cleanupOutdatedCaches: true,
                    // Force new cache revision on each build so old PWA cache is busted
                    cacheId: 'spotyfree-v2',
                    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MiB limit
                    // Define runtime caching strategies
                    runtimeCaching: [
                        {
                            urlPattern: ({ request }) =>
                                request.destination === 'script' || request.destination === 'worker',
                            handler: 'NetworkFirst',
                            options: {
                                cacheName: 'scripts',
                                networkTimeoutSeconds: 3,
                                expiration: {
                                    maxEntries: 200,
                                    maxAgeSeconds: 7 * 24 * 60 * 60,
                                },
                            },
                        },
                        {
                            urlPattern: ({ request }) =>
                                request.destination === 'style' || request.destination === 'font',
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'static-resources',
                                expiration: {
                                    maxEntries: 60,
                                    maxAgeSeconds: 60 * 24 * 60 * 60,
                                },
                            },
                        },
                        {
                            urlPattern: ({ request }) => request.destination === 'image',
                            handler: 'StaleWhileRevalidate',
                            options: {
                                // v2: o cache antigo guardou respostas "opacas" que quebram imagens com crossorigin
                                cacheName: 'images-v2',
                                expiration: {
                                    maxEntries: 500,
                                    maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
                                },
                                plugins: [
                                    {
                                        // Respostas opacas (sem CORS) nunca vão para o cache
                                        cacheWillUpdate: async ({ response }) =>
                                            response && response.type !== 'opaque' && response.status === 200
                                                ? response
                                                : null,
                                    },
                                ],
                            },
                        },
                        {
                            urlPattern: ({ request }) =>
                                request.destination === 'audio' || request.destination === 'video',
                            handler: 'CacheFirst',
                            options: {
                                // v2: o cache antigo 'media' guardou HTML do SPA como se fosse áudio
                                cacheName: 'media-v2',
                                expiration: {
                                    maxEntries: 50,
                                    maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                                },
                                plugins: [
                                    {
                                        // Só guarda no cache o que realmente é mídia (nunca HTML/JSON de erro)
                                        cacheWillUpdate: async ({ response }) => {
                                            const type = response.headers.get('content-type') || '';
                                            const isMedia =
                                                type.startsWith('audio/') ||
                                                type.startsWith('video/') ||
                                                type.includes('octet-stream');
                                            return response.status === 200 && isMedia ? response : null;
                                        },
                                    },
                                ],
                                rangeRequests: true, // Support scrubbing
                            },
                        },
                    ],
                },
                includeAssets: ['discord.html'],
                manifest: false, // Use existing public/manifest.json
            }),
        ],
    };
});
