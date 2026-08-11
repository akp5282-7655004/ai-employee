import { spawn } from 'node:child_process';
import pkg from '/home/user/leadman/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const PORT = 3191, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['dist/index.js'], { cwd: '/home/user/ai-employee', env: { ...process.env, PORT: String(PORT), MILES_NO_SCHEDULER:'1' }, stdio: 'inherit' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function up(){ for(let i=0;i<50;i++){ try{ if((await fetch(BASE+'/health')).ok) return; }catch(e){} await sleep(200);} throw 0; }
try {
  await up();
  const su = await fetch(BASE+'/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'sk@miles.ai',password:'password123',name:'Sk'})});
  const token = /miles_session=([^;]+)/.exec(su.headers.get('set-cookie'))[1];
  const H = { 'content-type':'application/json', cookie:`miles_session=${token}` };
  await fetch(BASE+'/api/profile',{method:'PUT',headers:H,body:JSON.stringify({businessName:'Rivera Plumbing & AC',industry:'Home Services',serviceAreas:'Phoenix'})});
  await fetch(BASE+'/api/skills',{method:'PUT',headers:H,body:JSON.stringify({installed:['google-ads','meta-ads','reviews']})});
  const play = await (await fetch(BASE+'/api/skills/play',{method:'POST',headers:H,body:JSON.stringify({skillId:'google-ads',playId:'rsa'})})).json();
  console.log('PLAY (no key → demo):', play.text.slice(0,120));
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless:true });
  const ctx = await b.newContext({ viewport:{width:1100,height:900}, deviceScaleFactor:2 });
  await ctx.addCookies([{ name:'miles_session', value:token, domain:'127.0.0.1', path:'/' }]);
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/', { waitUntil:'networkidle' }); await sleep(1000);
  await page.click('a[data-page="skills"]'); await sleep(600);
  await page.click('.acard button:has-text("Open")'); await sleep(500);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/skilldetail.png', fullPage:true });
  console.log('JS errors:', errs.length? errs : 'none');
  await b.close();
} catch(e){ console.error('ERR', e); } finally { srv.kill('SIGKILL'); }
