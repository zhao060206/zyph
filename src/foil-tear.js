const grip = event => event.target.closest('.frog-tear');

function paint(button,value){button.querySelector('.foil-pouch').style.setProperty('--tear',value.toFixed(3));}

export function bindTear(root,commit){
  let pull=null,skipClick=null;
  root.addEventListener('pointerdown',event=>{
    const button=grip(event);
    if(!button||button.dataset.opening||!event.isPrimary||event.button!==0)return;
    skipClick=null;
    pull={button,id:event.pointerId,x:event.clientX,y:event.clientY,span:button.getBoundingClientRect().width*.62,progress:0,moved:false};
    button.setPointerCapture(event.pointerId);
  });
  const update=event=>{
    const dx=event.clientX-pull.x,dy=event.clientY-pull.y;
    if(Math.abs(dx)>5||Math.abs(dy)>8)pull.moved=true;
    pull.progress=Math.min(1,Math.abs(dx)/Math.max(1,pull.span));
    pull.button.querySelector('.foil-pouch').classList.toggle('pull-left',dx<0);
    paint(pull.button,pull.progress);
  };
  root.addEventListener('pointermove',event=>{if(pull?.id===event.pointerId)update(event);});
  function release(event){
    if(pull?.id!==event.pointerId)return;
    const up=event.type==='pointerup';if(up)update(event);
    const {button,progress,moved}=pull;pull=null;
    if(moved||!up)skipClick=button;
    if(up&&progress>=1)commit(button,true);else paint(button,0);
  }
  for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,release);
  root.addEventListener('click',event=>{
    const button=grip(event);if(!button)return;
    if(event.detail!==0&&skipClick===button){skipClick=null;return;}
    commit(button,false);
  });
}

export function finishTear(button,fromDrag){
  const tier=document.documentElement.dataset.motion;
  if(fromDrag||tier==='none'||matchMedia('(prefers-reduced-motion: reduce)').matches||document.hidden){paint(button,1);return Promise.resolve();}
  const start=performance.now(),duration=tier==='full'?420:190;
  return new Promise(resolve=>{
    const frame=now=>{
      if(!button.isConnected||document.hidden){paint(button,1);resolve();return;}
      const t=Math.min(1,(now-start)/duration);
      paint(button,t*t*(3-2*t));
      if(t<1)requestAnimationFrame(frame);else resolve();
    };
    requestAnimationFrame(frame);
  });
}
