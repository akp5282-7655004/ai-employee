import { spawn } from 'node:child_process';
import pkg from '/home/user/leadman/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const PORT = 3271, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['dist/index.js'], { cwd: '/home/user/ai-employee', env: { ...process.env, PORT: String(PORT), MILES_NO_SCHEDULER:'1' }, stdio:'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function up(){ for(let i=0;i<40;i++){ try{ if((await fetch(BASE+'/health')).ok) return; }catch(e){} await sleep(200);} throw 0; }
try {
  await up();
  const r = await fetch(BASE+'/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'a@test.ai',password:'password123',name:'A'})});
  const token = /miles_session=([^;]+)/.exec(r.headers.get('set-cookie'))[1];
  await fetch(BASE+'/api/profile',{method:'PUT',headers:{'content-type':'application/json',cookie:`miles_session=${token}`},body:JSON.stringify({businessName:'Painters In Philly',industry:'Home Services'})});
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless:true });
  const ctx = await b.newContext({ viewport:{width:1150,height:1050}, deviceScaleFactor:2 });
  await ctx.addCookies([{ name:'miles_session', value:token, domain:'127.0.0.1', path:'/' }]);
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/', { waitUntil:'domcontentloaded' }); await sleep(1200);
  await page.click('a[data-page="schedules"]'); await sleep(600);
  // deploy the 6pm wrap-up + email agents with one click
  await page.click('.folgrid .acard:has-text("6pm daily wrap-up") button'); await sleep(300);
  await page.click('.folgrid .acard:has-text("Morning email") button'); await sleep(400);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/agents.png', fullPage:true });
  console.log('JS errors:', errs.length? errs : 'none');
  await b.close();
} catch(e){ console.error('ERR', String(e).slice(0,200)); } finally { srv.kill('SIGKILL'); }
