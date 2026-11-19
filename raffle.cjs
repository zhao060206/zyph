'use strict';
const crypto = require('node:crypto');
const stock = { white:32, silver:5, gold:2, prism:1 };
const owner = req => {
  const raw = /(?:^|;\s*)pt_darkbag=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
  return raw && crypto.createHash('sha256').update(raw[1]).digest('hex');
};

module.exports = function createRaffle(adapter) {
  const {read,append,now=Date.now}=adapter;
  const events = [];
  const fail = (code, text) => { throw new adapter.HttpError(code,text); };
  async function sync() {
    for (;;) {
      const event = await read(events.length);
      if (!event) return;
      if (!['draw','pause','publish','end','claim'].includes(event.action)) throw new Error('卡袋记录格式无效');
      events.push(event);
    }
  }
  function state() {
    const left = {...stock}, draws = [], claims = new Set(); let status='published';
    for (const event of events) {
      if (event.action==='draw') { left[event.tier]--; draws.push(event); }
      else if (event.action==='claim') claims.add(event.number);
      else status=({pause:'paused',publish:'published',end:'ended'})[event.action];
    }
    return {left, draws, claims, remaining:40-draws.length, status:draws.length===40?'ended':status};
  }
  function requireLive(s) { if(s.status!=='published') fail(409,s.status==='paused'?'活动已暂停':'本期已结束'); }
  function result(row) {return row ? {number:row.number,tier:row.tier} : null;}
  async function save(event) {
    if (!await append(events.length,event)) fail(409,'奖池刚刚更新，请重试');
    events.push(event);
  }
  function task(pending,photos) {
    return {albums:pending?.albums.length||0,social:!!pending?.marks.some(mark=>{
      const rec=photos[mark.key];
      return mark.kind==='like'?rec?.likes.some(item=>item.id===mark.id && item.ts===mark.ts):rec?.comments.some(item=>item.id===mark.id);
    })};
  }
  function publicState(s,key,pending,photos) {return {status:s.status,remaining:s.remaining,joined:!!pending,result:result(s.draws.find(row=>row.owner===key)),...task(pending,photos)};}
  function mark(req,store,key,kind,id,ts) {
    const entry=store.rafflePending[owner(req)];
    if (!entry || entry.marks.some(m=>m.kind===kind&&m.id===id&&m.ts===ts&&m.key===key)) return;
    entry.marks=[{key,kind,id,ts},...entry.marks.filter(m=>m.kind!==kind||m.key!==key)].slice(0,20);
  }
  async function route({req,res,path,body,store,json,persist,requireAdmin,catalog,ip,rateLimit}) {
    const action=path.slice('/api/raffle'.length)||'/status';
    if(req.method!==(action==='/status'?'GET':'POST')) fail(405,'请求方法无效');
    if(!['/status','/join','/album','/draw','/admin'].includes(action)) fail(404,'未知操作');
    if(!rateLimit(ip,'raffle'+action,action==='/join'?20:100,60000)) fail(429,'操作过于频繁');
    if(action==='/admin') requireAdmin(body);
    await sync(); const s=state(); let key=owner(req), pending=store.rafflePending[key];
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
    if(action==='/status') {
      if(pending?.marks.length && s.status==='published' && !s.draws.some(row=>row.owner===key)) {
        const {keys}=await catalog(); pending={...pending,marks:pending.marks.filter(mark=>keys.has(mark.key))};
      }
      return json(res,200,publicState(s,key,pending,store.photos));
    }
    const ownDraw=s.draws.find(row=>row.owner===key);
    if(ownDraw) return json(res,200,publicState(s,key,pending,store.photos));
    requireLive(s);
    if(action==='/join') {
      const qq=String(body.qq||'').trim(); if(!/^[1-9]\d{4,11}$/.test(qq)) fail(400,'请输入有效的 QQ 号');
      if(s.draws.some(row=>row.qq===qq)) fail(409,'这个 QQ 已经拆过本期卡袋');
      if(!pending) {
        const raw=crypto.randomBytes(32).toString('hex'); key=crypto.createHash('sha256').update(raw).digest('hex');
        for(const [id,entry] of Object.entries(store.rafflePending)) if(now()-entry.ts>30*86400000) delete store.rafflePending[id];
        if(Object.keys(store.rafflePending).length>=5000) fail(503,'参与人数较多，请稍后再试');
        pending=store.rafflePending[key]={qq,ts:now(),albums:[],marks:[]}; await persist();
        res.setHeader('Set-Cookie',`pt_darkbag=${raw}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=15552000${req.socket.encrypted||req.headers['x-forwarded-proto']==='https'?'; Secure':''}`);
      } else if(pending.qq!==qq) fail(409,'当前浏览器已登记其他 QQ');
    } else {
      if(!pending) fail(401,'请先填写 QQ，并允许本站保存参与凭证');
      if(s.draws.some(row=>row.qq===pending.qq)) fail(409,'这个 QQ 已经拆过本期卡袋');
      const {albums,keys}=await catalog();
      if(action==='/album') {
        if(!albums.has(body.day)) fail(400,'相册不存在');
        if(pending.albums.length<2&&!pending.albums.includes(body.day)) {pending.albums.push(body.day);await persist();}
      } else {
        const progress=task({...pending,marks:pending.marks.filter(mark=>keys.has(mark.key))},store.photos);
        if(progress.albums<2||!progress.social) fail(409,'请先完成看展任务');
        let ticket=crypto.randomInt(s.remaining); const tier=Object.keys(stock).find(name=>(ticket-=s.left[name])<0);
        const row={action:'draw',owner:key,qq:pending.qq,tier,number:s.draws.length+1,ts:now()};
        await save(row); return json(res,200,publicState(state(),key,pending,store.photos));
      }
    }
    return json(res,200,publicState(s,key,pending,store.photos));
  }
  return {route,mark,participating:(req,store)=>{
    const key=owner(req);if(!key||!store.rafflePending[key])return false;
    const current=state();return current.status==='published'&&!current.draws.some(row=>row.owner===key);
  }};
};
