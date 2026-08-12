import { spawn } from 'node:child_process';
import pkg from '/home/user/leadman/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const PORT = 3261, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['dist/index.js'], { cwd: '/home/user/ai-employee', env: { ...process.env, PORT: String(PORT), MILES_NO_SCHEDULER:'1' }, stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function up(){ for(let i=0;i<40;i++){ try{ if((await fetch(BASE+'/health')).ok) return; }catch(e){} await sleep(200);} throw 0; }
try {
  await up();
  const r = await fetch(BASE+'/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'new@test.ai',password:'password123',name:'New'})});
  const token = /miles_session=([^;]+)/.exec(r.headers.get('set-cookie'))[1];
  // simulate a completed crawl by pre-filling the onboard form via evaluate
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless:true });
  const ctx = await b.newContext({ viewport:{width:820,height:1150}, deviceScaleFactor:2 });
  await ctx.addCookies([{ name:'miles_session', value:token, domain:'127.0.0.1', path:'/' }]);
  const page = await ctx.newPage();
  await page.goto(BASE+'/', { waitUntil:'domcontentloaded' }); await sleep(1200);
  // fake an import result to show the auto-fill + note
  await page.evaluate(()=>{
    const d={website:'https://riveraplumbing.com',businessName:'Rivera Plumbing & AC',description:'Fast, honest plumbing and AC repair in Phoenix.',services:'Drain Cleaning, Water Heater Repair, AC Tune-Up, Sewer Line',phone:'(602) 555-0142',email:'hi@riveraplumbing.com',city:'Phoenix',state:'AZ',zip:'85001',facebook:'https://facebook.com/riveraplumbing',instagram:'https://instagram.com/riveraplumbing',brandColor:'#0c5aa6'};
    document.querySelector('#ob-website').value='riveraplumbing.com';
    const n=window.applyImportToForm(document.querySelector('#onboard-form'), d);
    document.querySelector('#ob-import-note').textContent='✓ Imported '+n+' fields — review below and fill in the rest.';
  });
  await sleep(400);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/onboard.png', fullPage:true });
  await b.close(); console.log('OK');
} catch(e){ console.error('ERR', String(e).slice(0,200)); } finally { srv.kill('SIGKILL'); }
