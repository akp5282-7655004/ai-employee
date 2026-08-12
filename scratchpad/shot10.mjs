import { spawn } from 'node:child_process';
import pkg from '/home/user/leadman/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const PORT = 3251, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['dist/index.js'], { cwd: '/home/user/ai-employee', env: { ...process.env, PORT: String(PORT), MILES_NO_SCHEDULER:'1' }, stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function up(){ for(let i=0;i<40;i++){ try{ if((await fetch(BASE+'/health')).ok) return; }catch(e){} await sleep(200);} throw 0; }
try {
  await up();
  const r = await fetch(BASE+'/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'c@test.ai',password:'password123',name:'C'})});
  const token = /miles_session=([^;]+)/.exec(r.headers.get('set-cookie'))[1];
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless:true });
  const ctx = await b.newContext({ viewport:{width:700,height:600}, deviceScaleFactor:2 });
  await ctx.addCookies([{ name:'miles_session', value:token, domain:'127.0.0.1', path:'/' }]);
  const page = await ctx.newPage();
  await page.goto(BASE+'/', { waitUntil:'domcontentloaded' }); await sleep(1000);
  const out = await page.evaluate(async ()=>{
    // synthetic "generated image": teal gradient 640x800
    const mk=(w,h,draw)=>{ const c=document.createElement('canvas'); c.width=w; c.height=h; draw(c.getContext('2d'),w,h); return c.toDataURL('image/png'); };
    const imgUrl=mk(640,800,(x,w,h)=>{ const g=x.createLinearGradient(0,0,w,h); g.addColorStop(0,'#0c6b52'); g.addColorStop(1,'#0c9e72'); x.fillStyle=g; x.fillRect(0,0,w,h); x.fillStyle='#fff'; x.font='bold 60px sans-serif'; x.textAlign='center'; x.fillText('PAINTERS',w/2,360); x.fillText('IN PHILLY',w/2,430); });
    const logoUrl=mk(240,120,(x,w,h)=>{ x.fillStyle='#1b3a5b'; x.fillRect(0,0,w,h); x.fillStyle='#f5b301'; x.beginPath(); x.arc(60,60,40,0,7); x.fill(); x.fillStyle='#fff'; x.font='bold 34px sans-serif'; x.fillText('ACME',110,72); });
    const composited = await window.compositeLogo(imgUrl, logoUrl);
    const im=document.createElement('img'); im.id='cmp'; im.style.cssText='max-width:420px;border:1px solid #ccc;border-radius:12px'; im.src=composited||imgUrl;
    document.body.innerHTML=''; document.body.style.cssText='background:#fff;display:grid;place-items:center;height:100vh'; document.body.appendChild(im);
    return { ok: !!composited, len: (composited||'').length };
  });
  console.log('composite ok:', out.ok, 'dataURL length:', out.len);
  await sleep(400);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/logo-composite.png' });
  await b.close();
} catch(e){ console.error('ERR', String(e).slice(0,200)); } finally { srv.kill('SIGKILL'); }
