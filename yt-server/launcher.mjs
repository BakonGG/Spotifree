// yt-server/launcher.mjs
// Roda no PC: liga o servidor de áudio, abre um túnel gratuito da Cloudflare e avisa o site do endereço atual.
// Configuração em config.json (ao lado deste arquivo). Pare com Ctrl+C ou fechando a janela.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
const PORT = String(cfg.port || 8787);
const stamp = () => new Date().toLocaleTimeString('pt-BR');
const log = (...a) => console.log(`[${stamp()}]`, ...a);

let serverProc = null;
let tunnelProc = null;
let tunnelUrl = null;
let stopping = false;

function startServer() {
    serverProc = spawn(process.execPath, [join(here, 'server.js')], {
        cwd: here,
        env: {
            ...process.env,
            PORT: PORT,
            YTDLP_BIN: cfg.ytdlpBin,
            ALLOWED_ORIGINS: (cfg.allowedOrigins || []).join(','),
            SOURCE_ORDER: 'youtube,soundcloud', // no PC o YouTube funciona sem cookies
            YT_ENABLED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout.on('data', (d) => process.stdout.write(`  [servidor] ${d}`));
    serverProc.stderr.on('data', (d) => process.stdout.write(`  [servidor] ${d}`));
    serverProc.on('exit', (code) => {
        log(`servidor de áudio saiu (código ${code})`);
        if (!stopping) setTimeout(startServer, 2000);
    });
}

async function register(url) {
    try {
        const res = await fetch(cfg.registryUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-registry-secret': cfg.secret },
            body: JSON.stringify({ url }),
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) log(`aviso ao site falhou: HTTP ${res.status}`);
        return res.ok;
    } catch (err) {
        log('aviso ao site falhou:', err.message);
        return false;
    }
}

function startTunnel() {
    tunnelUrl = null;
    tunnelProc = spawn(cfg.cloudflaredBin, ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = async (chunk) => {
        const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match && !tunnelUrl) {
            tunnelUrl = match[0];
            log(`túnel no ar: ${tunnelUrl}`);
            const ok = await register(tunnelUrl);
            log(ok ? 'site avisado: o áudio agora vem do seu PC' : 'não consegui avisar o site (vou tentar de novo)');
        }
    };
    tunnelProc.stdout.on('data', onData);
    tunnelProc.stderr.on('data', onData);
    tunnelProc.on('exit', (code) => {
        log(`túnel saiu (código ${code})`);
        tunnelUrl = null;
        if (!stopping) setTimeout(startTunnel, 3000);
    });
}

// Batimento: o site só usa o PC se ele avisou nos últimos 3 minutos
setInterval(() => {
    if (tunnelUrl) register(tunnelUrl);
}, 60 * 1000);

function shutdown() {
    stopping = true;
    log('encerrando...');
    serverProc?.kill();
    tunnelProc?.kill();
    setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

log('Spotifree: servidor de áudio do PC');
log('Deixe esta janela aberta enquanto quiser ouvir música no site.');
startServer();
startTunnel();
