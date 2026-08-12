import { spawn } from 'node:child_process';
import pkg from '/home/user/leadman/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const PORT = 3241, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['dist/index.js'], { cwd: '/home/user/ai-employee', env: { ...process.env, PORT: String(PORT), MILES_NO_SCHEDULER:'1' }, stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function up(){ for(let i=0;i<40;i++){ try{ if((await fetch(BASE+'/health')).ok) return; }catch(e){} await sleep(200);} throw 0; }
async function signup(email,name){ const r=await fetch(BASE+'/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'password123',name})}); return /miles_session=([^;]+)/.exec(r.headers.get('set-cookie'))?.[1]; }
try {
  await up();
  const owner = await signup('paul@smbhacker.com','Paul');
  const t1 = await signup('mike@rivera.com','Mike Rivera');
  const t2 = await signup('sara@acmehvac.com','Sara Chen');
  await fetch(BASE+'/api/profile',{method:'PUT',headers:{'content-type':'application/json',cookie:`miles_session=${owner}`},body:JSON.stringify({businessName:'Painters In Philly',industry:'Home Services'})});
  const H=t=>({'content-type':'application/json',cookie:`miles_session=${t}`});
  await fetch(BASE+'/api/feedback',{method:'POST',headers:H(t1),body:JSON.stringify({message:'The flyer looks WAY better now — text is clean. Could Miles drop my logo on automatically?',rating:5,page:'Creative Studio'})});
  await fetch(BASE+'/api/feedback',{method:'POST',headers:H(t2),body:JSON.stringify({message:'Video took a bit to render but the result was great. The morning brief is 🔥',rating:4,page:'Scheduled Agents'})});
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless:true });
  const ctx = await b.newContext({ viewport:{width:1120,height:900}, deviceScaleFactor:2 });
  await ctx.addCookies([{ name:'miles_session', value:owner, domain:'127.0.0.1', path:'/' }]);
  const page = await ctx.newPage();
  await page.goto(BASE+'/', { waitUntil:'domcontentloaded' }); await sleep(1400);
  await page.click('a[data-page="settings"]'); await sleep(400);
  await page.click('[data-stab="feedback"]'); await sleep(700);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/fb-inbox.png', fullPage:true });
  // then the tester popup
  await page.click('#fb-btn'); await sleep(400);
  await page.click('#fb-stars .fb-star[data-n="5"]'); await sleep(120);
  await page.fill('#fb-msg','Faster than hiring an agency 👏'); await sleep(120);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/fb-modal.png', fullPage:true });
  await b.close(); console.log('OK');
} catch(e){ console.error('ERR', String(e).slice(0,200)); } finally { srv.kill('SIGKILL'); }
