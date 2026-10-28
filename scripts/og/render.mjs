// scripts/og/render.mjs
// Gera as imagens de preview de link (1200x630) em public/assets/. Rode com: node scripts/og/render.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', '..', 'public', 'assets');
const logo = `data:image/png;base64,${readFileSync(join(assets, 'icone.png')).toString('base64')}`;

const base = `
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1200px; height: 630px; overflow: hidden; background: #040705; }
  body { font-family: 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif; color: #fff; position: relative; }
  .bg { position: absolute; inset: 0;
    background:
      radial-gradient(900px 560px at 8% -10%, rgba(0, 168, 67, .55), transparent 60%),
      radial-gradient(700px 480px at 100% 110%, rgba(255, 223, 0, .30), transparent 60%),
      radial-gradient(600px 420px at 78% 8%, rgba(0, 39, 118, .55), transparent 65%),
      #040705; }
  .grid { position: absolute; inset: 0; opacity: .10;
    background-image: linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px);
    background-size: 48px 48px; mask-image: radial-gradient(ellipse at 30% 40%, #000 0%, transparent 70%); }
  .diamond { position: absolute; width: 620px; height: 620px; right: -150px; top: 5px; transform: rotate(45deg) scale(.72);
    border: 2px solid rgba(255, 223, 0, .30); border-radius: 56px; }
  .diamond.b { transform: rotate(45deg) scale(.52); border-color: rgba(0, 168, 67, .45); }
  .logo { width: 132px; height: 132px; border-radius: 34px; background: #000; position: relative; overflow: hidden;
    box-shadow: 0 0 0 2px rgba(0, 220, 90, .85), 0 0 70px rgba(0, 220, 90, .55), inset 0 0 40px rgba(0, 168, 67, .35); }
  .logo img { width: 100%; height: 100%; object-fit: cover; mix-blend-mode: screen; }
  .logo::after { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(0,220,90,.55), rgba(255,223,0,.25)); mix-blend-mode: multiply; }
  .word { font-weight: 800; letter-spacing: -3px; line-height: .95;
    background: linear-gradient(90deg, #fff 30%, #7dffb0 75%, #ffe94d); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .eq { display: flex; gap: 6px; align-items: flex-end; height: 56px; }
  .eq i { display: block; width: 9px; border-radius: 5px; background: linear-gradient(#ffe94d, #00dc5a); }
  .chip { display: inline-flex; align-items: center; gap: 10px; padding: 12px 22px; border-radius: 999px; font-size: 24px; white-space: nowrap; font-weight: 600;
    background: rgba(255, 255, 255, .08); border: 1px solid rgba(255, 255, 255, .16); backdrop-filter: blur(6px); }
  .glass { background: linear-gradient(160deg, rgba(255, 255, 255, .16), rgba(255, 255, 255, .05)); border: 1px solid rgba(255, 255, 255, .22);
    box-shadow: 0 30px 80px rgba(0, 0, 0, .55); border-radius: 34px; backdrop-filter: blur(14px); }
</style>`;

const eqBars = (heights) => `<div class="eq">${heights.map((h) => `<i style="height:${h}px"></i>`).join('')}</div>`;

const defaultCard = `
<!doctype html><meta charset="utf-8">${base}
<div class="bg"></div><div class="grid"></div><div class="diamond"></div><div class="diamond b"></div>

<div style="position:absolute; left:72px; top:72px; display:flex; align-items:center; gap:28px">
  <div class="logo"><img src="${logo}"></div>
  <div>
    <div class="word" style="font-size:104px">Spotifree</div>
  </div>
</div>

<div style="position:absolute; left:72px; top:236px; width:640px">
  <div style="font-size:54px; font-weight:800; line-height:1.08; letter-spacing:-1.5px">
    Toda a música.<br><span style="color:#5dff9f">Zero anúncios.</span><br><span style="color:#ffe94d">De graça.</span>
  </div>
</div>

<div style="position:absolute; left:72px; bottom:62px; display:flex; gap:12px; flex-wrap:nowrap; width:760px">
  <span class="chip" style="font-size:21px; padding:11px 18px">🎧 Ouça em grupo</span>
  <span class="chip" style="font-size:21px; padding:11px 18px">📥 Importe do Spotify</span>
  <span class="chip" style="font-size:21px; padding:11px 18px"><span style="width:15px; height:15px; background:#ffdf00; transform:rotate(45deg); border-radius:3px; box-shadow:0 0 0 3px #00a843"></span> Feito no Brasil</span>
</div>

<!-- cartão de "tocando agora" -->
<div class="glass" style="position:absolute; right:78px; top:96px; width:372px; height:446px; padding:26px; transform:rotate(5deg)">
  <div style="width:100%; height:236px; border-radius:24px; position:relative; overflow:hidden;
       background: radial-gradient(circle at 50% 50%, #002776 0 34%, transparent 35%), linear-gradient(135deg, #00a843, #19d46a 55%, #ffdf00)">
    <div style="position:absolute; left:50%; top:50%; width:150px; height:150px; margin:-75px 0 0 -75px; background:#ffdf00; transform:rotate(45deg) scale(.88); border-radius:14px; opacity:.0"></div>
    <div style="position:absolute; inset:0; display:grid; place-items:center">
      <div style="width:92px; height:92px; border-radius:50%; background:rgba(255,255,255,.95); display:grid; place-items:center; box-shadow:0 12px 30px rgba(0,0,0,.4)">
        <div style="width:0; height:0; margin-left:8px; border-left:30px solid #04210f; border-top:19px solid transparent; border-bottom:19px solid transparent"></div>
      </div>
    </div>
  </div>
  <div style="margin-top:22px; font-size:28px; font-weight:800; letter-spacing:-.5px">Sua trilha, seu jeito</div>
  <div style="margin-top:4px; font-size:20px; opacity:.7">Spotifree • Playlist</div>
  <div style="margin-top:20px; height:8px; border-radius:6px; background:rgba(255,255,255,.2); overflow:hidden"><div style="width:62%; height:100%; background:linear-gradient(90deg,#00dc5a,#ffe94d)"></div></div>
  <div style="margin-top:8px; display:flex; justify-content:space-between; font-size:15px; opacity:.6"><span>2:14</span><span>3:36</span></div>
</div>

<div class="glass" style="position:absolute; right:30px; bottom:62px; padding:16px 24px; border-radius:22px; display:flex; align-items:center; gap:14px; transform:rotate(-3deg)">
  <div style="display:flex">
    <span style="width:44px; height:44px; border-radius:50%; background:linear-gradient(135deg,#ff7ab6,#ff4d6d); border:3px solid #0b110d"></span>
    <span style="width:44px; height:44px; border-radius:50%; background:linear-gradient(135deg,#ffe94d,#ffa600); border:3px solid #0b110d; margin-left:-14px"></span>
    <span style="width:44px; height:44px; border-radius:50%; background:linear-gradient(135deg,#5dff9f,#00a843); border:3px solid #0b110d; margin-left:-14px"></span>
  </div>
  <div style="font-size:21px; font-weight:700">Ouvindo juntos</div>
</div>`;

const partyCard = `
<!doctype html><meta charset="utf-8">${base}
<div class="bg" style="background:
  radial-gradient(800px 560px at 50% 120%, rgba(0,168,67,.6), transparent 62%),
  radial-gradient(700px 480px at 0% 0%, rgba(255,77,109,.28), transparent 60%),
  radial-gradient(700px 480px at 100% 0%, rgba(255,223,0,.30), transparent 60%), #040705"></div>
<div class="grid"></div>

<!-- ondas saindo do centro -->
<div style="position:absolute; left:50%; top:50%; width:1px; height:1px">
  <div style="position:absolute; width:760px; height:760px; margin:-380px; border-radius:50%; border:2px solid rgba(93,255,159,.14)"></div>
  <div style="position:absolute; width:560px; height:560px; margin:-280px; border-radius:50%; border:2px solid rgba(93,255,159,.24)"></div>
  <div style="position:absolute; width:380px; height:380px; margin:-190px; border-radius:50%; border:2px solid rgba(255,233,77,.34)"></div>
</div>

<div style="position:absolute; left:0; right:0; top:58px; display:flex; justify-content:center">
  <div class="chip" style="font-size:25px; font-weight:800; letter-spacing:.14em; background:rgba(255,45,85,.18); border-color:rgba(255,45,85,.55)">
    <span style="width:14px; height:14px; border-radius:50%; background:#ff2d55; box-shadow:0 0 18px #ff2d55"></span> AO VIVO • SESSÃO DE ESCUTA
  </div>
</div>

<div style="position:absolute; left:0; right:0; top:128px; text-align:center">
  <div class="word" style="font-size:132px; letter-spacing:-5px">Vem ouvir junto!</div>
  <div style="margin:14px auto 0; width:880px; font-size:35px; line-height:1.3; opacity:.88; font-weight:500">
    Entre na sessão e escute a mesma música, <b style="color:#ffe94d">no mesmo segundo</b>, com a galera.
  </div>
</div>

<!-- rostinhos + play -->
<div style="position:absolute; left:0; right:0; bottom:58px; display:flex; justify-content:center; align-items:center; gap:34px">
  <div style="display:flex">
    ${['#ff7ab6,#ff4d6d', '#ffe94d,#ffa600', '#5dff9f,#00a843', '#7aa7ff,#2b5bff', '#d49bff,#8a3dff']
        .map((g, i) => `<span style="width:78px; height:78px; border-radius:50%; background:linear-gradient(135deg,${g}); border:5px solid #07100a; margin-left:${i ? -20 : 0}px; display:grid; place-items:center; font-size:34px">${['😎', '🤩', '🥳', '😄', '🎧'][i]}</span>`)
        .join('')}
  </div>
  <div style="width:112px; height:112px; border-radius:50%; background:linear-gradient(135deg,#19d46a,#ffe94d); display:grid; place-items:center; box-shadow:0 0 70px rgba(25,212,106,.65)">
    <div style="width:0; height:0; margin-left:10px; border-left:38px solid #04210f; border-top:24px solid transparent; border-bottom:24px solid transparent"></div>
  </div>
  <div>${eqBars([30, 52, 38, 62, 44, 28, 56, 36])}</div>
</div>

<div style="position:absolute; left:46px; top:44px; display:flex; align-items:center; gap:14px; opacity:.95">
  <div class="logo" style="width:64px; height:64px; border-radius:18px"><img src="${logo}"></div>
  <span style="font-size:32px; font-weight:800; letter-spacing:-1px">Spotifree</span>
</div>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const [name, html] of [
    ['og-default.png', defaultCard],
    ['og-party.png', partyCard],
]) {
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    writeFileSync(join(assets, name), await page.screenshot({ type: 'png' }));
    console.log('gerado', name);
}
await browser.close();
