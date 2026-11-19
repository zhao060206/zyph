const cards={white:['J','♧','白卡','奶蛙收藏卡'],silver:['Q','♤','银卡','随机照片冰箱贴 × 1'],gold:['K','♡','金卡','奈雪杨枝甘露套餐 × 1'],prism:['A','♢','炫彩卡','星巴克大杯太妃拿铁 × 1']};
const lifecycle={published:'进行中',paused:'已暂停',ended:'已结束'};
const artFor=({tier,number})=>{const variant=(number-1)%(tier==='white'?4:tier==='silver'?2:1);return tier+(variant?'-'+variant:'');};
const button=(action,label)=>`<button type="button" class="frog-btn" data-frog="${action}">${label}</button>`;
export function createRaffleUI({$,call,auth}) {
  const body=()=>$('#frogBody'), modal=()=>$('#frogModal'), msg=text=>{$('#frogMessage').textContent=text;};
  let active=false, version=0, drawing=false, state, visiting=Promise.resolve(), visitError='', drag=null;
  try{active=localStorage.getItem('pt_frog_joined')==='1';}catch{}
  function joined(value){active=value;$('#frogReturn').hidden=!active;try{localStorage.setItem('pt_frog_joined',value?'1':'0');}catch{}}
  const pack=()=>`<div class="frog-pack" aria-hidden="true"><i class="frog-seal"></i><div class="frog-envelope"><small>PHOTOTROPIC</small><b>♢</b><span>MILK FROG</span><small>SEALED EDITION · 01</small></div></div>`;
  function render(data,animate=false){
    state=data; joined(data.joined&&!data.result&&data.status==='published');
    if(data.result){
      const {tier,number}=data.result,[rank,suit,name,prize]=cards[tier];
      const corner=`<span class="frog-pip">${rank}<i>${suit}</i></span>`;
      body().innerHTML=`<div class="frog-stage ${animate?'frog-reveal':''}"><article class="frog-card frog-${tier}" aria-label="${name}">${corner}<figure><img width="512" height="512" src="/assets/frog/${artFor(data.result)}.webp" alt="${name}奶蛙收藏画"><figcaption><small>EDITION 01 · Nº ${String(number).padStart(2,'0')}</small><strong>${name}</strong></figcaption></figure>${corner}</article>${animate?pack():''}</div><p class="frog-prize">${prize}</p><p class="frog-note">${tier==='white'?'本袋无实物奖品，可在此回看卡片。':'站主将通过登记的 QQ 联系兑奖。'}</p>`;
      msg(''); return;
    }
    if(data.status!=='published'){body().innerHTML=`<p class="frog-prize">${lifecycle[data.status]}</p><p class="frog-note">${data.status==='paused'?'本期暂时停止拆袋。':'本期抽选已经结束。'}</p>`;return;}
    if(!data.joined){body().innerHTML=`<div class="frog-intro"><span aria-hidden="true">♧ ♤ ♡ ♢</span><strong>40 袋 / 8 份实物</strong></div><p class="frog-rules">银卡 · 随机照片冰箱贴 × 5<br>金卡 · 奈雪杨枝甘露套餐 × 2<br>炫彩 · 星巴克大杯太妃拿铁 × 1<br>白卡 · 奶蛙收藏卡 × 32</p><p class="frog-note">随机不放回，初始中奖率 20%。余 ${data.remaining} 袋。每个 QQ 限拆一次，仅用于去重和联系兑奖。</p><form id="frogForm"><label for="frogQQ">参与 QQ</label><input id="frogQQ" inputmode="numeric" autocomplete="off" pattern="[1-9][0-9]{4,11}" maxlength="12" required><button class="frog-btn">登记并看展</button></form>`;return;}
    const ready=data.albums>=2&&data.social;
    body().innerHTML=`<p class="frog-check">打开不同相册 <b>${data.albums} / 2</b></p><p class="frog-check">给照片点赞或评论 <b>${data.social?1:0} / 1</b></p>${ready?`<button type="button" data-frog="draw" class="frog-tear" aria-label="拆开卡袋">${pack()}<span>沿封口横撕，或点按拆袋</span></button>`:button('browse','去看作品 ↗')}`;
  }
  async function load(){const ticket=++version;msg('读取卡袋…');try{await visiting;const data=await call('');if(ticket!==version)return;msg(visitError);render(data);}catch(e){if(ticket===version){body().innerHTML=button('reload','重新读取');msg(e.message);}}}
  function close(){++version;modal().hidden=true;body().replaceChildren();drag=null;}
  async function draw(){if(drawing||state?.result)return;drawing=true;const ticket=version;msg('正在拆袋…');const tear=body().querySelector('.frog-tear');if(tear)tear.disabled=true;
    try{const data=await call('/draw',{});if(ticket===version)render(data,true);}catch(e){if(ticket===version){body().innerHTML=button('reload','查看卡袋状态');msg(e.message);}}finally{drawing=false;}}
  async function admin(op='list',number){const box=$('#frogAdminBody'),note=$('#frogAdminMessage');note.textContent='读取中…';
    try{const data=await call('/admin',{...auth(),action:op,number});note.textContent='';box.innerHTML=`<p>${lifecycle[data.status]} · 已拆 ${40-data.remaining} / 40</p>${data.status==='published'?button('pause','暂停'):data.status==='paused'?button('publish','重新发布'):''}${data.status!=='ended'?button('ask-end','结束并留档'):''}<ol class="frog-records">${data.rows.map(row=>`<li>#${row.number} · ${cards[row.tier][2]} · QQ ${row.qq} ${row.tier==='white'?'':row.claimed?'已兑付':button('claim:'+row.number,'标记已兑付')}</li>`).join('')}</ol>`;}catch(e){box.replaceChildren();note.textContent=e.message;}}
  return {close,album(day){if(!active)return;visiting=visiting.then(()=>call('/album',{day})).then(()=>{visitError='';},e=>{visitError='相册进度未记录：'+e.message;});},init(){
    $('#frogReturn').hidden=!active; $('#frogOpen').onclick=$('#frogReturn').onclick=()=>{modal().hidden=false;body().replaceChildren();load();}; $('#frogClose').onclick=close;
    modal().addEventListener('click',e=>{if(e.target===modal())return close();const action=e.target.closest('[data-frog]')?.dataset.frog;if(action==='draw')draw();if(action==='reload')load();if(action==='browse'){close();if(!$('#groupPage').hidden)$('#gpBack').click();else $('#galleryTitle').scrollIntoView({block:'start'});}});
    body().addEventListener('submit',async e=>{e.preventDefault();const ticket=version,form=e.target;form.querySelector('button').disabled=true;msg('');try{const data=await call('/join',{qq:$('#frogQQ').value.trim()});joined(true);if(ticket===version)render(data);}catch(error){if(ticket===version){msg(error.message);form.querySelector('button').disabled=false;}}});
    body().addEventListener('pointerdown',e=>{const el=e.target.closest('.frog-tear');if(!el||drawing)return;drag={id:e.pointerId,x:e.clientX,el};el.setPointerCapture(e.pointerId);});
    body().addEventListener('pointermove',e=>{if(drag?.id!==e.pointerId)return;let progress=Math.min(1,Math.abs(e.clientX-drag.x)/90);drag.el.style.setProperty('--tear',progress.toFixed(2));if(progress>=1){drag=null;draw();}});
    for(const type of ['pointerup','pointercancel'])body().addEventListener(type,()=>{if(drag)drag.el.style.removeProperty('--tear');drag=null;});
    $('#frogAdminRefresh').onclick=()=>admin();document.querySelector('[data-tab="raffle"]').addEventListener('click',()=>admin());$('#frogAdminBody').onclick=e=>{const el=e.target.closest('[data-frog]');if(!el)return;const [op,num]=el.dataset.frog.split(':');if(op==='ask-end'){el.outerHTML=button('end','确认永久结束')+button('list','取消');return;}el.disabled=true;admin(op,num?Number(num):undefined);};
  }};
}
