const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const zlib = require('node:zlib');
const { once } = require('node:events');

const project = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(project, 'server.js'), 'utf8');
const admin = { token: 'test-admin-only' };
const visitor = { id: 'test-visitor-0001', name: '测试访客', avatar: 'a1' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function app(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phototropic-test-'));
  fs.writeFileSync(path.join(dir, 'gallery.json'), JSON.stringify({ groups: [{ d: '2026-01-01', gs: ['a', 'b', 'c'].map(name => ({ k: `photos/${name}.jpg` })) }] }));
  if (options.raw !== undefined) fs.writeFileSync(path.join(dir, 'interactions.json'), options.raw);
  else if (options.seed) fs.writeFileSync(path.join(dir, 'interactions.json'), JSON.stringify(options.seed));
  const env = { DATA_DIR: dir, ADMIN_TOKEN: admin.token, ...options.env };
  const fake = options.cos || {};
  class FakeCOS {
    getObject(params, callback) { fake.get ? fake.get(params, callback) : callback(null, { Body: '{}' }); }
    putObject(params, callback) { fake.put ? fake.put(params, callback) : callback(null, {}); }
    deleteObject(params, callback) { fake.delete ? fake.delete(params, callback) : callback(null, {}); }
  }
  const context = vm.createContext({
    require: name => name === 'cos-nodejs-sdk-v5' ? FakeCOS : require(name),
    module: { exports: {} }, __dirname: project,
    process: { env, pid: process.pid }, Buffer, URL, setTimeout, clearTimeout,
    console: { log() {}, error() {} },
  });
  vm.runInContext(source, context, { filename: 'server.js' });
  const { server, loadStore } = context.module.exports;
  if (!options.skipLoad) await loadStore();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    base, dir, loadStore,
    async request(route, body, raw) {
      const response = await fetch(base + route, body === undefined && raw === undefined ? undefined : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw === undefined ? JSON.stringify(body) : raw,
      });
      return { status: response.status, data: await response.json() };
    },
    async manage(type, action, config) {
      return this.request('/api/activities/admin', { ...admin, type, action, config });
    },
  };
}

test('raffle verifies tasks, survives retries, blocks duplicate QQ and awards only the last available bag', async t=>{
  const site=await app(t); const keys=['first','second'];
  fs.writeFileSync(path.join(site.dir,'gallery.json'),JSON.stringify({groups:keys.map(d=>({d,gs:[{k:'photos/'+d}]}))}));
  const journal=path.join(site.dir,'private/darkbag-02');fs.mkdirSync(journal,{recursive:true});
  const existing=[...Array(32).fill('white'),...Array(5).fill('silver'),...Array(2).fill('gold')];
  existing.forEach((tier,i)=>fs.writeFileSync(path.join(journal,String(i).padStart(4,'0')+'.json'),JSON.stringify({action:'draw',tier,owner:'seed'+i,qq:String(20000+i),number:i+1,ts:1})));
  const api=async(route,body,cookie='')=>{const resp=await fetch(site.base+'/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined});return {status:resp.status,data:await resp.json(),cookie:resp.headers.get('set-cookie')?.split(';')[0]};};
  assert.equal((await api('raffle/admin',{action:'list'})).status,403);
  assert.equal((await api('raffle/join',{qq:'bad'})).status,400);
  assert.equal((await api('raffle/join',{qq:'20001'})).status,409);
  const participants=[];
  for(const qq of ['30001','30002']){
    const {cookie}=await api('raffle/join',{qq}); assert.ok(cookie);
    assert.deepEqual((await api('raffle',null,cookie)).data.packs.map(p=>p.earned),[true,false,false]);
    assert.equal((await api('raffle/draw',{slot:'photo'},cookie)).status,409);
    assert.equal((await api('raffle/photo',{key:'fake'},cookie)).status,400);
    for(const name of ['first','first','second'])await api('raffle/photo',{key:'photos/'+name},cookie);
    assert.deepEqual((await api('raffle',null,cookie)).data.packs.map(p=>p.earned),[true,true,false]);
    const input={key:'photos/first',visitor:{...visitor,id:'visitor-'+qq}};
    assert.equal((await api('raffle/draw',{slot:'social'},cookie)).status,409);
    if(qq==='30001')await api('comment',{...input,text:'喜欢这张'},cookie);else await api('like',input,cookie);
    participants.push(cookie);
  }
  const pulls=await Promise.all(participants.map(cookie=>api('raffle/draw',{},cookie)));
  assert.deepEqual(pulls.map(r=>r.status),[200,200]);const win=pulls.findIndex(r=>r.data.result.tier==='prism');assert.equal(pulls[1-win].data.result.tier,'white');
  assert.deepEqual(pulls[win].data.result,{number:40,tier:'prism'});
  assert.deepEqual((await api('raffle/draw',{},participants[win])).data.result,pulls[win].data.result);
  const replay=await app(t);fs.cpSync(site.dir,replay.dir,{recursive:true});
  const restarted=await fetch(replay.base+'/api/raffle',{headers:{cookie:participants[win]}});assert.deepEqual((await restarted.json()).result,pulls[win].data.result);
  const pub=(await api('raffle')).data;assert.equal(pub.result,null);assert.equal(pub.remaining,0);assert.ok(!JSON.stringify(pub).includes('30001'));
  const cookie=participants[win];const repeat=await Promise.all([api('raffle/draw',{slot:'photo'},cookie),api('raffle/draw',{slot:'photo'},cookie)]);assert.deepEqual(repeat[0].data.packs,repeat[1].data.packs);
  const third=await api('raffle/draw',{slot:'social'},cookie);assert.equal(third.data.packs.filter(p=>p.card).length,3);assert.equal(third.data.result.tier,'white');
  const report=(await api('raffle/admin',{...admin,action:'claim',number:40})).data;assert.equal(report.rows[39].claimed,true);assert.equal(report.rows.length,43);
});

test('previously opened cards occupy the welcome slot without losing earned bonus packs',async t=>{
  const site=await app(t);const raw='a'.repeat(64),owner=require('node:crypto').createHash('sha256').update(raw).digest('hex');
  const dir=path.join(site.dir,'private/darkbag-02');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'0000.json'),JSON.stringify({action:'draw',owner,number:1,tier:'gold',qq:'53841',ts:1}));
  const call=async(route,body)=>{const res=await fetch(site.base+'/api/raffle'+route,{method:body?'POST':'GET',headers:{cookie:'pt_darkbag_v2='+raw,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});assert.equal(res.status,200);return res.json();};
  const old=await call('/draw',{slot:'welcome'});assert.deepEqual(old.result,{number:1,tier:'gold'});assert.equal(old.remaining,39);
  await call('/photo',{key:'photos/a.jpg'});const next=await call('/draw',{slot:'photo'});assert.equal(next.remaining,38);assert.deepEqual(next.packs[0].card,old.result);
  const replay=await call('/draw',{slot:'welcome'});assert.deepEqual(replay.result,old.result);assert.equal(replay.remaining,38);
});

test('raffle pause, publish and permanent close preserve the edition',async t=>{
  const site=await app(t);const set=action=>site.request('/api/raffle/admin',{...admin,action});
  assert.equal((await set('pause')).data.status,'paused');assert.equal((await site.request('/api/raffle/join',{qq:'12345'})).status,409);
  assert.equal((await set('publish')).data.status,'published'); assert.equal((await set('end')).data.status,'ended');assert.equal((await set('publish')).status,409);
});

test('new installations keep activities in draft and require admin authentication', async t => {
  const site = await app(t);
  assert.equal((await site.request('/api/health')).data.ok, true);
  assert.deepEqual((await site.request('/api/activities')).data.current, []);
  assert.equal((await site.request('/api/activities/admin', { action: 'list' })).status, 403);
  const response = await site.request('/api/activities/admin', { ...admin, action: 'list' });
  assert.equal(response.status, 200);
  assert.ok(response.data.current.every(item => item.config.status === 'draft'));
  assert.equal((await site.request('/api/vote/submit', { key: 'photos/a.jpg', visitor, qq: '12345678' })).status, 400);
});

test('publish, participate, end, archive, start a new event, and preserve the old record', async t => {
  const site = await app(t);
  assert.equal((await site.manage('voting', 'save', { title: '第一期', maxVotes: 2 })).status, 200);
  assert.equal((await site.manage('voting', 'publish', { title: '第一期', maxVotes: 2 })).status, 200);
  let response = await site.request('/api/vote/submit', { keys: ['photos/a.jpg', 'photos/b.jpg'], visitor, qq: '12345678' });
  assert.equal(response.status, 200);
  assert.equal((await site.request('/api/vote/submit', { key: 'photos/a.jpg', visitor, qq: '87654321' })).status, 400);
  assert.equal((await site.request('/api/vote/submit', { key: 'photos/a.jpg', visitor: { ...visitor, id: 'another-visitor' }, qq: '12345678' })).status, 400);
  assert.equal((await site.manage('voting', 'new')).status, 409);
  response = await site.manage('voting', 'end');
  assert.equal(response.status, 200);
  assert.equal(response.data.history[0].count, 2);
  assert.equal(response.data.history[0].participants, 1);
  const id = response.data.history[0].config.eventId;
  assert.equal((await site.request('/api/vote/submit', { key: 'photos/c.jpg', visitor: { ...visitor, id: 'third-visitor' }, qq: '23456789' })).status, 400);
  assert.equal((await site.manage('voting', 'publish', { title: '非法重开' })).status, 409);
  assert.equal((await site.manage('voting', 'new')).status, 200);
  assert.equal((await site.manage('voting', 'publish', { title: '第二期', maxVotes: 1 })).status, 200);
  assert.equal((await site.request('/api/vote/submit', { key: 'photos/c.jpg', visitor, qq: '12345678' })).status, 200);
  response = await site.request('/api/activities/admin', { ...admin, action: 'history', id });
  assert.equal(response.data.record.config.title, '第一期');
  assert.equal(response.data.record.votes['photos/a.jpg'][0].qq, '12345678');
  await site.loadStore();
  response = await site.request('/api/activities/admin', { ...admin, action: 'list' });
  assert.equal(response.data.history.length, 1);
  assert.equal(response.data.current.find(item => item.type === 'voting').participants, 1);
});

test('public responses omit contact records and visitor identifiers, while own social state works', async t => {
  const site = await app(t);
  await site.manage('voting', 'publish', { title: '公开测试' });
  await site.request('/api/vote/submit', { key: 'photos/a.jpg', visitor, qq: '12345678' });
  await site.request('/api/like', { key: 'photos/a.jpg', visitor });
  await site.request('/api/comment', { key: 'photos/a.jpg', visitor, text: '<script>example</script>' });
  const own = await site.request('/api/interactions?vid=' + visitor.id);
  assert.deepEqual(Object.keys(own.data), ['photos']);
  assert.equal(own.data.photos['photos/a.jpg'].likes[0].mine, true);
  assert.equal(own.data.photos['photos/a.jpg'].comments[0].mine, true);
  const anonymous = await site.request('/api/interactions');
  assert.equal(anonymous.data.photos['photos/a.jpg'].comments[0].mine, false);
  const publicText = JSON.stringify([own.data, anonymous.data, (await site.request('/api/activities')).data]);
  assert.ok(!publicText.includes('12345678'));
  assert.ok(!publicText.includes(visitor.id));
});

test('forged ballots cannot create votes for nonexistent photographs or an old event', async t => {
  const site = await app(t);
  await site.manage('voting', 'publish', { title: '校验作品目录' });
  assert.equal((await site.request('/api/vote/submit', { key: 'photos/fake.jpg', visitor, qq: '12345678' })).status, 400);
  assert.equal((await site.request('/api/vote/submit', { key: 'photos/a.jpg', visitor, qq: '12345678', eventId: 'old-event' })).status, 409);
  const result = await site.request('/api/vote/admin/results', admin);
  assert.equal(result.data.totalVotes, 0);
});

test('submissions validate all images, prevent concurrent duplicates, archive photos and delete actual files', async t => {
  const site = await app(t);
  await site.manage('submissions', 'publish', { title: '投稿测试', maxPhotos: 3 });
  let result = await site.request('/api/submission/submit', { visitor, qq: '12345678', photos: [{ data: png }, { data: 'data:image/png;base64,PHNjcmlwdD4=' }] });
  assert.equal(result.status, 400);
  const body = { visitor, qq: '12345678', photos: [{ data: png, tn: png, title: '一张照片' }] };
  const responses = await Promise.all([site.request('/api/submission/submit', body), site.request('/api/submission/submit', body)]);
  assert.deepEqual(responses.map(item => item.status).sort(), [200, 400]);
  const item = responses.find(item => item.status === 200).data.item;
  const photo = await fetch(site.base + '/' + item.photos[0].k);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');
  const end = await site.manage('submissions', 'end');
  const history = await site.request('/api/activities/admin', { ...admin, action: 'history', id: end.data.history[0].config.eventId });
  assert.equal(history.data.record.items[0].photos[0].k, item.photos[0].k);
  const deletion = await site.request('/api/photo/delete', { ...admin, keys: [item.photos[0].k] });
  assert.equal(deletion.status, 200);
  assert.equal(fs.existsSync(path.join(site.dir, item.photos[0].k)), false);
  assert.equal((await site.request('/api/photo/delete', { ...admin, keys: ['interactions.json'] })).status, 400);
});

test('expired legacy activities are ended once, recorded and interpreted at UTC+08:00', async t => {
  const site = await app(t, { seed: { voting: { config: { enabled: true, title: '旧活动', deadline: '2000-01-01 01:00', maxVotes: 1 }, votes: {}, voters: {} } } });
  let status = await site.request('/api/vote/config');
  assert.equal(status.data.status, 'ended');
  assert.equal(status.data.enabled, false);
  let records = await site.request('/api/activities');
  assert.equal(records.data.history.length, 1);
  assert.equal(records.data.history[0].config.endReason, 'deadline');
  assert.equal(records.data.history[0].config.endedAt, Date.parse('2000-01-01T01:00+08:00'));
  await site.request('/api/activities');
  assert.equal((await site.request('/api/activities')).data.history.length, 1);
  assert.equal((await site.manage('voting', 'new')).status, 200);
  assert.equal((await site.manage('voting', 'publish', { title: '无截止时间' })).status, 200);
  records = await site.request('/api/activities');
  assert.equal(records.data.current.find(item => item.type === 'voting').config.deadline, '');
});

test('disabled legacy activity records survive migration and do not carry into the next period', async t => {
  const seed = { voting: { config: { enabled: false, title: '旧版已关闭活动' }, votes: { 'photos/a.jpg': [{ visitorId: visitor.id, qq: '12345678', ts: 1 }] }, voters: { [visitor.id]: { qq: '12345678', key: 'photos/a.jpg' } } } };
  const site = await app(t, { seed });
  const state = await site.request('/api/activities/admin', { ...admin, action: 'list' });
  assert.equal(state.data.history[0].count, 1);
  assert.equal(state.data.current.find(item => item.type === 'voting').config.status, 'ended');
  const next = await site.manage('voting', 'new');
  assert.equal(next.data.current.find(item => item.type === 'voting').participants, 0);
  assert.equal(next.data.history[0].count, 1);
});

test('the installed COS 3 SDK reads, writes private JSON and deletes through a real local HTTP transport', async t => {
  const COS = require('cos-nodejs-sdk-v5');
  const calls = [];
  const transport = http.createServer((req, res) => {
    calls.push({ method: req.method, acl: req.headers['x-cos-acl'], type: req.headers['content-type'] });
    req.resume();
    req.on('end', () => { res.writeHead(req.method === 'DELETE' ? 204 : 200, { 'Content-Type': 'application/json', ETag: 'test-etag' }); res.end(req.method === 'GET' ? '{"photos":{}}' : undefined); });
  });
  transport.listen(0, '127.0.0.1'); await once(transport, 'listening');
  t.after(() => { transport.closeAllConnections(); transport.close(); });
  const client = new COS({ SecretId: 'test-fake-id', SecretKey: 'test-fake-key', Domain: `127.0.0.1:${transport.address().port}`, Protocol: 'http:', MaxRetries: 0, Timeout: 2000 });
  const object = { Bucket: 'test-1234567890', Region: 'ap-nanjing', Key: 'interactions.json' };
  const invoke = (method, params) => new Promise((resolve, reject) => client[method](params, (error, data) => error ? reject(error) : resolve(data)));
  const read = await invoke('getObject', object);
  assert.equal(read.Body.toString(), '{"photos":{}}');
  await invoke('putObject', { ...object, Body: Buffer.from('{}'), ContentType: 'application/json; charset=utf-8', ACL: 'private' });
  await invoke('deleteObject', object);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'PUT', 'DELETE']);
  assert.equal(calls[1].acl, 'private');
});

test('invalid configuration does not change a running activity or leak prototype properties', async t => {
  const site = await app(t);
  await site.manage('voting', 'publish', { title: '正确活动', maxVotes: 1 });
  assert.equal((await site.manage('voting', 'save', { title: '不应保存', deadline: 'invalid' })).status, 400);
  assert.equal((await site.request('/api/vote/config')).data.title, '正确活动');
  assert.equal((await site.request('/api/like', { key: '__proto__', visitor })).status, 200);
  const social = await site.request('/api/interactions');
  assert.ok(Object.hasOwn(social.data.photos, '__proto__'));
});

test('unreadable or corrupt persistence fails closed and keeps the original data', async t => {
  const site = await app(t, { raw: '{broken', skipLoad: true });
  assert.equal((await site.request('/api/comment', { key: 'photos/a.jpg', visitor, text: 'hello' })).status, 503);
  assert.equal((await site.request('/api/health')).status, 503);
  assert.equal(fs.readFileSync(path.join(site.dir, 'interactions.json'), 'utf8'), '{broken');
});

test('failed COS writes return failure, roll back, recover and preserve the private ACL', async t => {
  let fail = true;
  const writes = [];
  const site = await app(t, { env: { COS_SECRET_ID: 'test-fake-id', COS_SECRET_KEY: 'test-fake-key' }, cos: {
    put(params, callback) { writes.push(params); setTimeout(() => callback(fail ? new Error('simulated write error') : null, {}), 15); },
  } });
  const body = { key: 'photos/a.jpg', visitor };
  assert.equal((await site.request('/api/like', body)).status, 503);
  assert.deepEqual((await site.request('/api/interactions')).data.photos, {});
  fail = false;
  assert.equal((await site.request('/api/like', body)).status, 200);
  assert.equal(writes[0].ACL, 'private');
});

test('bad, non-object and oversized bodies return client errors without resetting the connection', async t => {
  const site = await app(t);
  assert.equal((await site.request('/api/comment', undefined, '{bad')).status, 400);
  assert.equal((await site.request('/api/comment', null)).status, 400);
  assert.equal((await site.request('/api/comment', [])).status, 400);
  assert.equal((await site.request('/api/comment', { text: 'a'.repeat(65536) })).status, 413);
  assert.equal((await site.request('/api/health')).status, 200);
});

test('an interrupted upload cannot stall the API transaction queue', async t => {
  const site = await app(t, { env: { COS_SECRET_ID: 'test-fake-id', COS_SECRET_KEY: 'test-fake-key' }, cos: {
    put(params, callback) { setTimeout(() => callback(null, {}), 100); },
  } });
  const write = site.request('/api/like', { key: 'photos/a.jpg', visitor });
  await new Promise(resolve => setTimeout(resolve, 10));
  const interrupted = http.request(site.base + '/api/comment', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1000' } });
  interrupted.on('error', () => {});
  interrupted.write('{"text":');
  await new Promise(resolve => setTimeout(resolve, 20));
  interrupted.destroy();
  await write;
  const status = await Promise.race([site.request('/api/interactions'), new Promise((resolve, reject) => setTimeout(() => reject(new Error('API queue stalled')), 1000))]);
  assert.equal(status.status, 200);
});

test('HTML and assets support compression, conditional caching and HEAD', async t => {
  const site = await app(t);
  const raw = (route, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    http.get(site.base + route, { headers, method }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  const plain = await raw('/');
  const compressed = await raw('/', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(compressed.headers['content-encoding'], 'br');
  assert.ok(compressed.body.length < plain.body.length / 2);
  assert.equal(zlib.brotliDecompressSync(compressed.body).toString(), plain.body.toString());
  assert.equal((await raw('/', { 'If-None-Match': compressed.headers.etag, 'Accept-Encoding': 'br' })).status, 304);
  assert.equal((await raw('/', { 'Accept-Encoding': 'br;q=0,gzip;q=0' })).headers['content-encoding'], undefined);
  assert.equal((await raw('/assets/app.js', {}, 'HEAD')).body.length, 0);
  assert.equal((await raw('/assets/site.css')).status, 200);
  const tones = await raw('/assets/tone-index.json', { 'Accept-Encoding': 'br' });
  assert.equal(tones.status, 200);
  assert.match(tones.headers['content-type'], /application\/json/);
  const toneData = JSON.parse(zlib.brotliDecompressSync(tones.body));
  assert.equal(toneData.version, 1);
  assert.ok(Object.keys(toneData.photos).length > 0);
  assert.equal((await raw('/assets/tone-index.json', { 'If-None-Match': tones.headers.etag, 'Accept-Encoding': 'br' })).status, 304);
});
