'use strict';
const crypto = require('node:crypto');
const stock = { white:32, silver:5, gold:2, prism:1 };
const owner = req => {
  const raw = /(?:^|;\s*)pt_darkbag_v2=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
  return raw && crypto.createHash('sha256').update(raw[1]).digest('hex');
};

module.exports = function createRaffle(adapter) {
  const {read,append,now=Date.now}=adapter;
  const events = [];
  const tally={left:{...stock},draws:[],claims:new Set(),byOwner:new Map(),byQQ:new Map(),remaining:40,status:'published'};
  let counted=0,lastChecked=0;
  const fail = (code, text) => { throw new adapter.HttpError(code,text); };
  async function sync() {
    for (;;) {
      const event = await read(events.length);
      if (!event) {lastChecked=now();return;}
      if (!['draw','pause','publish','end','claim'].includes(event.action)) throw new Error('卡袋记录格式无效');
      events.push(event);
    }
  }
  function state() {
    for (;counted<events.length;counted++) {
      const event=events[counted];
      if (event.action==='draw') {
        if(tally.remaining){tally.left[event.tier]--;tally.remaining--;}
        tally.draws.push(event);tally.byQQ.set(event.qq,event.owner);
        if(!tally.byOwner.has(event.owner))tally.byOwner.set(event.owner,[]);
        tally.byOwner.get(event.owner).push(event);
        if(event.number===40&&!event.slot)tally.status='ended';
      } else if (event.action==='claim') tally.claims.add(event.number);
      else tally.status=({pause:'paused',publish:'published',end:'ended'})[event.action];
    }
    return tally;
  }
  function requireLive(s) { if(s.status!=='published') fail(409,s.status==='paused'?'活动已暂停':'本期已结束'); }
  function result(row) {return row ? {number:row.number,tier:row.tier} : null;}
  async function save(event) {
    if (!await append(events.length,event)) fail(409,'奖池刚刚更新，请重试');
    events.push(event);
  }
  function publicState(s,key,pending) {
    const own=s.byOwner.get(key)||[];
    const packs=['welcome','photo','social'].map(slot=>{
      const row=own.find(item=>(item.slot||'welcome')===slot);
      return {slot,earned:!!(row||pending&&(slot==='welcome'||pending[slot])),card:result(row)};
    });
    return {status:s.status,remaining:s.remaining,joined:!!pending||!!own.length,packs,result:result(own[own.length-1])};
  }
  function mark(req,store,key,kind,id,ts) {
    const entry=store.rafflePendingV2[owner(req)];
    if (!entry || entry.marks.some(m=>m.kind===kind&&m.id===id&&m.ts===ts&&m.key===key)) return;
    entry.marks=[{key,kind,id,ts},...entry.marks.filter(m=>m.kind!==kind||m.key!==key)].slice(0,20);
  }
  async function route({req,res,path,body,store,json,persist,requireAdmin,catalog,ip,rateLimit}) {
    const action=path.slice('/api/raffle'.length)||'/status';
    if(req.method!==(action==='/status'?'GET':'POST')) fail(405,'请求方法无效');
    if(!['/status','/join','/photo','/draw','/admin'].includes(action)) fail(404,'未知操作');
    if(!rateLimit(ip,'raffle'+action,action==='/join'?20:100,60000)) fail(429,'操作过于频繁');
    if(action==='/admin') requireAdmin(body);
    let key=owner(req);if(action!=='/status'||key||now()-lastChecked>=3000)await sync();const s=state();let pending=store.rafflePendingV2[key];
    if(action==='/admin') {
      const op=body.action||'list';
      if(op==='claim') {
        const row=s.draws.find(r=>r.number===body.number&&r.tier!=='white');
        if(!row) fail(404,'中奖记录不存在');
        if(!s.claims.has(row.number)) await save({action:'claim',number:row.number,ts:now()});
      } else if(op!=='list') {
        if(!({pause:s.status==='published',publish:s.status==='paused',end:s.status!=='ended'})[op] || !['pause','publish','end'].includes(op)) fail(409,'当前状态无法进行此操作');
        await save({action:op,ts:now()});
      }
      const updated=state(); return json(res,200,{status:updated.status,remaining:updated.remaining,rows:updated.draws.map(row=>({...result(row),qq:row.qq,ts:row.ts,claimed:updated.claims.has(row.number)}))});
    }
    const own=s.byOwner.get(key)||[];
    if(!pending&&own.length && s.status==='published') {
      pending=store.rafflePendingV2[key]={qq:own[0].qq,ts:now(),marks:[]};await persist();
    }
    if(pending&&!pending.social&&pending.marks.length&&s.status==='published'&&(action==='/status'||action==='/draw'&&body.slot==='social')) {
      const {keys}=await catalog();
      if(pending.marks.some(mark=>keys.has(mark.key))) {pending.social=true;await persist();}
    }
    if(action==='/status') return json(res,200,publicState(s,key,pending));
    const slot=body.slot||'welcome';
    const previous=own.find(row=>(row.slot||'welcome')===slot);
    if(action==='/draw'&&previous) return json(res,200,{...publicState(s,key,pending),result:result(previous)});
    requireLive(s);
    if(action==='/join') {
      const qq=String(body.qq||'').trim(); if(!/^[1-9]\d{4,11}$/.test(qq)) fail(400,'请输入有效的 QQ 号');
      if(s.byQQ.has(qq)&&s.byQQ.get(qq)!==key) fail(409,'这个 QQ 已在其他浏览器参与本期活动');
      if(!pending) {
        const raw=crypto.randomBytes(32).toString('hex'); key=crypto.createHash('sha256').update(raw).digest('hex');
        for(const [id,entry] of Object.entries(store.rafflePendingV2)) if(now()-entry.ts>30*86400000) delete store.rafflePendingV2[id];
        if(Object.keys(store.rafflePendingV2).length>=5000) fail(503,'参与人数较多，请稍后再试');
        pending=store.rafflePendingV2[key]={qq,ts:now(),albums:[],marks:[]}; await persist();
        res.setHeader('Set-Cookie',`pt_darkbag_v2=${raw}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=15552000${req.socket.encrypted||req.headers['x-forwarded-proto']==='https'?'; Secure':''}`);
      } else if(pending.qq!==qq) fail(409,'当前浏览器已登记其他 QQ');
    } else {
      if(!pending) fail(401,'请先填写 QQ，并允许本站保存参与凭证');
      if(s.byQQ.has(pending.qq)&&s.byQQ.get(pending.qq)!==key) fail(409,'这个 QQ 已在其他浏览器参与本期活动');
      if(action==='/photo') {
        if(!pending.photo){const {keys}=await catalog();if(!keys.has(body.key))fail(400,'照片不存在');pending.photo=true;await persist();}
      } else {
        if(!['welcome','photo','social'].includes(slot)||slot!=='welcome'&&!pending[slot]) fail(409,'这个卡包尚未解锁');
        let ticket=s.remaining?crypto.randomInt(s.remaining):0; const tier=s.remaining?Object.keys(stock).find(name=>(ticket-=s.left[name])<0):'white';
        const row={action:'draw',slot,owner:key,qq:pending.qq,tier,number:s.draws.length+1,ts:now()};
        await save(row); return json(res,200,publicState(state(),key,pending));
      }
    }
    return json(res,200,publicState(s,key,pending));
  }
  return {route,mark,participating:(req,store)=>{
    const key=owner(req);if(!key||!store.rafflePendingV2[key])return false;
    return !store.rafflePendingV2[key].social && state().status==='published';
  }};
};
