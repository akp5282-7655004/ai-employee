import { spawn } from 'node:child_process';
import pkg from '/home/user/leadman/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const PORT = 3231, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['dist/index.js'], { cwd: '/home/user/ai-employee', env: { ...process.env, PORT: String(PORT), MILES_NO_SCHEDULER:'1' }, stdio: 'inherit' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function up(){ for(let i=0;i<50;i++){ try{ if((await fetch(BASE+'/health')).ok) return; }catch(e){} await sleep(200);} throw 0; }
async function signup(email,name){ const r=await fetch(BASE+'/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'password123',name})}); return /miles_session=([^;]+)/.exec(r.headers.get('set-cookie'))?.[1]; }
try {
  await up();
  const owner = await signup('paul@smbhacker.com','Paul');
  const t1 = await signup('mike@rivera.com','Mike Rivera');
  const t2 = await signup('sara@acmehvac.com','Sara Chen');
  await fetch(BASE+'/api/profile',{method:'PUT',headers:{'content-type':'application/json',cookie:`miles_session=${owner}`},body:JSON.stringify({businessName:'Painters In Philly',industry:'Home Services'})});
  const H=t=>({'content-type':'application/json',cookie:`miles_session=${t}`});
  await fetch(BASE+'/api/feedback',{method:'POST',headers:H(t1),body:JSON.stringify({message:'The flyer looks WAY better now — text is clean. Could we add my logo automatically?',rating:5,page:'Creative Studio'})});
  await fetch(BASE+'/api/feedback',{method:'POST',headers:H(t2),body:JSON.stringify({message:'Video took a bit long to render but the result was great. Morning brief is 🔥',rating:4,page:'Scheduled Agents'})});
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless:true });
  const ctx = await b.newContext({ viewport:{width:1120,height:920}, deviceScaleFactor:2 });
  // tester view — the feedback popup
  await ctx.addCookies([{ name:'miles_session', value:t1, domain:'127.0.0.1', path:'/' }]);
  let page = await ctx.newPage();
  await page.goto(BASE+'/', { waitUntil:'networkidle' }); await sleep(1000);
  await page.click('#fb-btn'); await sleep(400);
  await page.click('#fb-stars .fb-star[data-n="5"]'); await sleep(150);
  await page.fill('#fb-msg','This is so much faster than hiring an agency 👏'); await sleep(150);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/fb-modal.png', fullPage:true });
  await ctx.clearCookies();
  // owner view — the inbox
  await ctx.addCookies([{ name:'miles_session', value:owner, domain:'127.0.0.1', path:'/' }]);
  page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/', { waitUntil:'networkidle' }); await sleep(1000);
  await page.click('a[data-page="settings"]'); await sleep(400);
  await page.click('[data-stab="feedback"]'); await sleep(700);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/fb-inbox.png', fullPage:true });
  console.log('JS errors:', errs.length? errs : 'none');
  await b.close();
} catch(e){ console.error('ERR', e); } finally { srv.kill('SIGKILL'); }
