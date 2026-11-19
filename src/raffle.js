import {bindTear,finishTear} from './foil-tear.js';
const tiers={white:['J','♧','白卡','奶蛙收藏卡'],silver:['Q','♤','银卡','随机照片冰箱贴'],gold:['K','♡','金卡','奈雪杨枝甘露套餐'],prism:['A','♢','炫彩卡','星巴克大杯太妃拿铁']};
const names={welcome:'入场包',photo:'看展包',social:'互动包'};
const hints={welcome:'进入活动',photo:'打开一张照片',social:'点赞或评论照片'};
const life={published:'进行中',paused:'已暂停',ended:'已结束'};
const seenKey='pt_frog_invite_v2';
const art=card=>{const v=(card.number-1)%(card.tier==='white'?4:card.tier==='silver'?2:1);return `/assets/frog/${card.tier}${v?'-'+v:''}.webp`;};
const btn=(op,text,cls='frog-btn')=>`<button type="button" class="${cls}" data-frog="${op}">${text}</button>`;
const pouch=()=>'<div class="foil-pouch" aria-hidden="true"><i class="foil-bottom"></i><i class="foil-top"></i></div>';
const tearPouch=()=>'<div class="foil-pouch foil-interactive" aria-hidden="true"><i class="foil-mouth"></i><i class="foil-bottom"></i><span class="foil-intact"><i class="foil-top"></i></span><span class="foil-flap"><i class="foil-top"></i></span><i class="foil-tip"></i></div>';
const face=card=>{const [rank,suit,name]=tiers[card.tier];const corner=`<span class="frog-corner" aria-hidden="true">${rank}<i>${suit}</i></span>`;return `${corner}<img width="512" height="512" src="${art(card)}" alt="${name}奶蛙" draggable="false"><span class="frog-legend"><strong>${name}</strong><small>Nº ${String(card.number).padStart(3,'0')}</small></span>${corner}`;};
const cardLabel=pack=>`${names[pack.slot]} · ${tiers[pack.card.tier][2]} Nº ${pack.card.number}`;
// A browser can suppress the next synthetic click directly after a horizontal touch drag.
function bindDeckTap(stage){
  let tap=null;
  stage.addEventListener('touchstart',e=>{
    const button=e.target.closest('button[data-frog^="switch:"]'),point=e.touches[0];
    tap=button&&e.touches.length===1?{button,x:point.clientX,y:point.clientY,id:point.identifier}:null;
  },{passive:true});
  const drifted=p=>!p||p.identifier!==tap.id||Math.hypot(p.clientX-tap.x,p.clientY-tap.y)>10;
  stage.addEventListener('touchmove',e=>{if(tap&&drifted(e.touches[0]))tap=null;},{passive:true});
  stage.addEventListener('touchcancel',()=>{tap=null;},{passive:true});
  stage.addEventListener('touchend',e=>{
    const button=tap&&!drifted(e.changedTouches[0])&&tap.button;tap=null;
    if(button&&e.cancelable){e.preventDefault();button.click();}
  },{passive:false});
}
export function createRaffleUI({$,call,auth}) {
  const modal=$('#frogModal'),body=$('#frogBody'),message=$('#frogMessage');let data=null,version=0,busy=false,active=false,visiting=Promise.resolve(),toastTimer,announced=false;
  try{active=localStorage.getItem('pt_frog_joined')==='1';}catch{}
  const flag=()=>{announced=true;try{sessionStorage.setItem(seenKey,'1');}catch{}};
  function toast(text){const node=$('#frogToast');node.textContent=text;node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{node.hidden=true;node.textContent='';},2300);}
  function remember(next){data=next;active=next.joined&&next.status==='published';$('#frogReturn').hidden=!next.joined;try{localStorage.setItem('pt_frog_joined',active?'1':'0');}catch{}}
  function close(){version++;modal.hidden=true;body.replaceChildren();message.textContent='';}
  function wall(){const slots=data.packs;const next=slots.find(v=>v.earned&&!v.card);const count=slots.filter(v=>v.earned&&!v.card).length;
    const rows=slots.map((v,i)=>{const status=v.card?tiers[v.card.tier][2]:v.earned?'可拆':'待解锁';const click=v.card?`show:${v.slot}`:v.earned&&data.status==='published'?`open:${v.slot}`:'browse';return `<button type="button" class="frog-slot" data-frog="${click}" ${!v.earned&&data.status!=='published'?'disabled':''}><small>0${i+1}</small><span><b>${names[v.slot]}</b><em>${hints[v.slot]}</em></span><i>${status} ${v.earned?'↗':''}</i></button>`;}).join('');
    return `<div class="frog-layout"><div class="foil-display">${pouch()}</div><div class="frog-copy"><small class="frog-eyebrow">我的收藏</small><h3>我的卡包</h3><p>${data.status!=='published'?life[data.status]:`${count} 个待拆 · 每个 QQ 最多三包`}</p><div class="frog-slots">${rows}</div>${next&&data.status==='published'?btn('open:'+next.slot,'拆'+names[next.slot]+' ↗'):data.status==='published'&&slots.some(v=>!v.earned)?btn('browse','去看照片 ↗'):''}</div></div>`;}
  function render(){message.textContent=data.status==='published'&&data.remaining===0?'首批奖袋已拆完，之后的卡包仅含收藏白卡。':'';if(data.joined){body.innerHTML=wall();return;}
    if(data.status!=='published'){body.innerHTML=`<div class="frog-copy"><h3>${life[data.status]}</h3><p>奶蛙暗袋 · 第一期</p></div>`;return;}
    body.innerHTML=`<div class="frog-layout"><div class="foil-display">${pouch()}</div><div class="frog-copy"><small class="frog-eyebrow">限时抽卡活动</small><h3>奶蛙暗袋<span>入场即领一包</span></h3><p>打开照片，再领一包。<br>点赞或评论，还能再领一包。</p><form id="frogForm"><label class="sr-only" for="frogQQ">参与 QQ</label><input id="frogQQ" inputmode="numeric" autocomplete="off" pattern="[1-9][0-9]{4,11}" maxlength="12" placeholder="输入 QQ 号" required><button class="frog-btn">领取入场包 ↗</button></form><details><summary>奖品与规则</summary><p>5 枚随机照片冰箱贴 · 2 套奈雪杨枝甘露 · 1 杯星巴克大杯太妃拿铁。首批 40 袋不放回，之后为白色收藏卡。${data.remaining?`首批余 ${data.remaining} 袋。`:'首批已抽完。'}QQ 仅用于去重与兑奖。</p></details></div></div>`;}
  function screen(slot,torn=null,focusSelector=''){
    const pack=data.packs.find(p=>p.slot===slot);if(!pack?.earned)return;
    const card=pack.card,opened=!!torn,owned=data.packs.filter(p=>p.card),count=owned.length,index=owned.indexOf(pack);
    const prev=owned[(index-1+count)%count],next=owned[(index+1)%count];message.textContent='';
    const side=(entry,side)=>`<button type="button" class="foil-sibling ${side}" data-frog="switch:${entry.slot}" aria-label="查看${cardLabel(entry)}"><span class="frog-card ${entry.card.tier}">${face(entry.card)}</span></button>`;
    let deck=`<button type="button" class="frog-tear" data-frog="tear:${slot}" aria-label="撕开${names[slot]}">${tearPouch()}</button>`,nav='';
    if(card){deck=count>1?`${count>2?side(prev,'left'):''}${side(next,'right')}<button type="button" class="frog-card ${card.tier}" data-frog="switch:${next.slot}" aria-label="${cardLabel(pack)}，下一张">${face(card)}</button>`:`<article class="frog-card ${card.tier}" aria-label="${cardLabel(pack)}">${face(card)}</article>`;}
    if(card&&count>1)nav=`<div class="frog-deck-nav"><button type="button" data-prev data-frog="switch:${prev.slot}" aria-label="上一张卡">‹</button><span>${index+1} / ${count}</span><button type="button" data-next data-frog="switch:${next.slot}" aria-label="下一张卡">›</button></div>`;
    body.innerHTML=`<div class="frog-opening"><div class="frog-theater ${opened?'foil-reveal':''}">${deck}</div><div class="frog-caption"><small class="frog-eyebrow">${names[slot]}</small><h3>${card?tiers[card.tier][3]:'沿封口撕开'}</h3><p>${card?(card.tier==='white'?'收藏卡 · 无实物':'站主将通过登记的 QQ 联系兑奖。'):'横向拖动撕开，或点按卡包'}</p>${nav}${btn('wall',card?'返回我的卡包':'返回','frog-link')}</div></div>`;
    if(card){const stage=body.querySelector('.frog-theater');if(count>1)bindDeckTap(stage);if(torn){const shell=document.createElement('div');shell.className='foil-shell';shell.setAttribute('aria-hidden','true');shell.append(torn);stage.append(shell);}
      if(opened&&document.documentElement.dataset.motion==='full'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const sparks=document.createElement('span');sparks.className='foil-flecks';sparks.setAttribute('aria-hidden','true');for(let i=0;i<9;i++){const fleck=document.createElement('i');fleck.style.setProperty('--dx',Math.round(Math.cos(i*2.4)*105)+'px');fleck.style.setProperty('--dy',Math.round(Math.sin(i*2.4)*60-48)+'px');fleck.style.setProperty('--spin',(i*53)+'deg');sparks.append(fleck);}stage.append(sparks);}}
    body.querySelector(focusSelector||(!card?'.frog-tear':count>1?'.frog-theater > button.frog-card':'.frog-link'))?.focus({preventScroll:true});}
  async function refresh(){const id=++version;message.textContent='正在读取卡包…';try{await visiting;const next=await call('');if(id!==version)return;remember(next);render();}catch(e){if(id===version){message.textContent=e.message;body.innerHTML=btn('reload','重新读取');}}}
  function open(){flag();modal.hidden=false;body.replaceChildren();refresh();}
  async function draw(button,fromDrag){if(busy||modal.hidden)return;const id=version,slot=button.dataset.frog.split(':')[1],torn=button.querySelector('.foil-pouch');busy=true;button.dataset.opening='1';body.querySelector('.frog-link').disabled=true;message.textContent='正在显影…';try{const [next]=await Promise.all([call('/draw',{slot}),finishTear(button,fromDrag)]);if(id!==version)return;remember(next);screen(slot,torn);}catch(e){if(id===version){message.textContent=e.message;body.innerHTML=btn('reload','查看我的卡包');}}finally{busy=false;}}
  async function announce(){try{if(sessionStorage.getItem(seenKey))return;}catch{}if(location.hash||document.hidden)return;const id=version;try{const next=await call('');if(id!==version||announced||next.status!=='published'||document.hidden||location.hash||document.querySelector('[aria-modal="true"]:not([hidden]):not(#lightbox)')||document.documentElement.dataset.dialogOpen==='true')return;remember(next);flag();modal.hidden=false;render();}catch{/* An unavailable event must not block the gallery. */}}
  async function admin(op='list',number){const box=$('#frogAdminBody'),note=$('#frogAdminMessage');note.textContent='读取中…';try{const res=await call('/admin',{...auth(),action:op,number});note.textContent='';box.innerHTML=`<p>${life[res.status]} · 已拆 ${res.rows.length} 包 · 首批余 ${res.remaining} 袋</p>${res.status==='published'?btn('pause','暂停'):res.status==='paused'?btn('publish','重新发布'):''}${res.status!=='ended'?btn('ask-end','结束并留档'):''}<ol class="frog-records">${res.rows.map(r=>`<li>#${r.number} · ${tiers[r.tier][2]} · QQ ${r.qq} ${r.tier==='white'?'':r.claimed?'已兑付':btn('claim:'+r.number,'标记已兑付')}</li>`).join('')}</ol>`;}catch(e){box.replaceChildren();note.textContent=e.message;}}
  function credit(slot,action,payload){if(!active||data?.packs.find(v=>v.slot===slot)?.earned)return;visiting=visiting.then(async()=>{if(!active||data?.packs.find(v=>v.slot===slot)?.earned)return;const next=await call(action,payload);remember(next);if(next.packs.find(v=>v.slot===slot)?.earned)toast(names[slot]+'已解锁');}).catch(()=>{toast('卡包进度未同步，请重新打开照片或查看卡包');});}
  return {close,photo(key){credit('photo','/photo',{key});},social(){credit('social','');},init(){
    const notice=document.createElement('div');notice.id='frogToast';notice.setAttribute('role','status');notice.hidden=true;document.body.append(notice);
    $('#frogReturn').hidden=!active;$('#frogOpen').onclick=$('#frogReturn').onclick=open;$('#frogClose').onclick=close;
    modal.addEventListener('click',e=>{if(e.target===modal)return close();const el=e.target.closest('[data-frog]');if(!el)return;const [op,slot]=el.dataset.frog.split(':');if(op==='wall')render();if(op==='reload')refresh();if(op==='open'||op==='show')screen(slot);if(op==='switch')screen(slot,null,el.hasAttribute('data-prev')?'[data-prev]':el.hasAttribute('data-next')?'[data-next]':'');if(op==='browse'){close();if(!$('#groupPage').hidden)$('#gpBack').click();else $('#galleryTitle').scrollIntoView({block:'start'});}});
    modal.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const arrow=body.querySelector(e.key==='ArrowLeft'?'[data-prev]':'[data-next]');if(arrow){e.preventDefault();arrow.click();}});
    body.addEventListener('submit',async e=>{e.preventDefault();const id=version,form=e.target;form.querySelector('button').disabled=true;try{const next=await call('/join',{qq:$('#frogQQ').value.trim()});remember(next);if(id===version){render();screen('welcome');}}catch(err){if(id===version){message.textContent=err.message;form.querySelector('button').disabled=false;}}});
    bindTear(body,draw);
    $('#frogAdminRefresh').onclick=()=>admin();document.querySelector('[data-tab="raffle"]').onclick=()=>admin();$('#frogAdminBody').onclick=e=>{const el=e.target.closest('[data-frog]');if(!el)return;const [op,num]=el.dataset.frog.split(':');if(op==='ask-end'){el.outerHTML=btn('end','确认永久结束')+btn('list','取消');return;}el.disabled=true;admin(op,num?Number(num):undefined);};announce();
  }};
}
