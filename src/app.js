import { createArchive } from './gallery.js';
import { createEventCenter } from './activities.js';
import { setupDialogs } from './dialogs.js';
import { createMotionController } from './motion.js';
import { createSeasons } from './seasons.js';
import { TONES, resolveTone } from './tones.mjs';
import { analyzeBlob } from './color-analysis.js';
(()=>{
'use strict';
const $=s=>document.querySelector(s);
const U=(id,w)=>`https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;
/* 转义:查表替换(旧版用 createElement+innerHTML,每次调用都要建一个 DOM 节点并触发HTML解析,
   在渲染评论列表这种循环里开销明显)。查表法纯字符串操作,快一个量级且行为完全一致 */
const ESC_MAP={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>ESC_MAP[c]);
const storageGet=(key,fallback='')=>{try{return localStorage.getItem(key)||fallback}catch(e){return fallback}};
const storageSet=(key,value)=>{try{localStorage.setItem(key,value);return true}catch(e){return false}};
const fetchWithTimeout=(url,opts={},ms=12000)=>{
  const c=typeof AbortController!=='undefined'?new AbortController():null;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{if(c)c.abort();reject(new Error('连接超时，请检查网络后重试'))},ms);
    fetch(url,c?{...opts,signal:c.signal}:opts).then(response=>{clearTimeout(timer);resolve(response)},error=>{clearTimeout(timer);reject(error.name==='AbortError'?new Error('连接超时，请检查网络后重试'):error)});
  });
};
const safeUrl=url=>esc(url||'');
const Motion=createMotionController();
const readCatalog=async(file,field)=>{
  const response=await fetchWithTimeout(cosURL(file),{cache:'no-store'},12000);
  if(response.status===404)return {[field]:[]};
  if(!response.ok)throw new Error('无法读取现有归档（'+response.status+'），本次未覆盖云端数据');
  const data=await response.json();
  if(!data||!Array.isArray(data[field]))throw new Error('云端归档格式无效，本次未覆盖数据');
  return data;
};

const isMine=record=>record&&(record.mine===true||record.id===Identity.id);


/* ─── 演示数据(云端未配置或 data.json 不存在时显示) ─── */
/* g: 组(某天); gs: 组内照片; d: 房主给某张照片的介绍(可选,显示在悬浮窗) */
const DEMO_GROUPS=[
 {d:'2026-08-24',loc:'杭州 · 钱塘江',title:'雾锁钱塘',note:'显影中',
  c:'江面吐了一夜的雾,天亮时塔浮在上面。等了两小时,只为雾散前的三分钟。同一片雾,拍了三个版本。',
  exif:'FUJIFILM X-T5 · XF 56mm F1.2 R WR<br>56mm · f/1.4 · 1/500s · ISO 320',
  gs:[
    {t:'雾中塔 · 之一',u:'photo-1470071459604-3b5ec3a7fe05',ph:['#23303b','#9BD8CC']},
    {t:'雾中塔 · 之二',u:'photo-1495562569060-2eec283d3391',ph:['#28343c','#8FCBBF'],d:'雾最浓的一刻,塔几乎要融进天里。'},
    {t:'雾中塔 · 之三',u:'photo-1506744038136-46273834b3fb',ph:['#1e2a33','#7FB3A6'],d:'雾散前的最后三分钟,光终于落回江面。'}
  ],
},
 {d:'2026-08-18',loc:'大兴安岭 · 呼中',title:'森林的呼吸',note:'显影中',
  c:'零下二十六度,冷杉一动不动。快门响的那一秒,整片林子呼出一口白气。',
  exif:'SONY α7R V · FE 16-35mm F2.8 GM<br>24mm · f/8 · ISO 200',
  gs:[
    {t:'森林的呼吸 · 广',u:'photo-1487621167305-5d248087c724',ph:['#0e1f1b','#2FA693']},
    {t:'森林的呼吸 · 竖',u:'photo-1448375240586-882707db888b',ph:['#0d1d19','#2c9c84']}
  ],
},
 {d:'2026-08-09',loc:'本溪 · 老边沟',title:'枫径',note:'显影中',
  c:'十月,雾未散,落叶没过脚踝。走到路的尽头回头——它像一条烧起来的河。',
  exif:'Nikon Z8 · Nikkor Z 70-200mm f/2.8<br>135mm · f/2.8 · ISO 400',
  gs:[
    {t:'枫径 · 正片',u:'photo-1477414348463-c0eb7f1359b6',ph:['#2b1710','#D4552E']},
    {t:'枫径 · 局部',u:'photo-1507041957456-9c397ce39c97',ph:['#2d1812','#EFA98A']}
  ],
},
 {d:'2026-08-03',loc:'川西 · 子梅垭口',title:'雪线之上',note:'显影中',
  c:'海拔四千六,风把云撕开一道口子,主峰只给了四十秒。四十秒,够记一辈子。',
  exif:'Canon EOS R6 II · RF 70-200mm F4<br>180mm · f/8 · ISO 100',
  gs:[
    {t:'雪线 · 主峰',u:'photo-1506905925346-21bda4d32df4',ph:['#1c2430','#9BD8CC']},
    {t:'雪线 · 云海',u:'photo-1464822759023-fed622ff2c3b',ph:['#1a2530','#8BBFD4']}
  ],
},
 {d:'2026-08-01',loc:'上海 · 武康路',title:'雨窗',note:'显影中',
  c:'躲雨的二十分钟。玻璃外的城市被雨点揉皱,每个光斑都是一枚没寄出的邮资。',
  exif:'FUJIFILM X100VI<br>23mm · f/2 · ISO 800',
  gs:[
    {t:'雨窗 · 之一',u:'photo-1428592953211-077101b2021b',ph:['#1a2027','#EFA98A']}
  ],
},
 {d:'2026-07-28',loc:'青海 · 翡翠湖',title:'湖之息',note:'定影完毕',
  c:'无人机升到一百二十米,湖面静得像一张没拆封的相纸。倒影里的山,比山更像山。',
  exif:'DJI Mavic 3 Pro · 哈苏镜头<br>24mm · f/4 · ISO 100',
  gs:[
    {t:'湖之息 · 俯瞰',u:'photo-1501785888041-af3ef285b470',ph:['#0f2830','#2FA693']}
  ],
},
 {d:'2026-07-15',loc:'长白山 · 二道白河',title:'林间尽头',note:'定影完毕',
  c:'白桦把季节交给枫树。林子尽头亮起来的那一刻,快门和心跳同一个频率。',
  exif:'Nikon Zf · 40mm f/2<br>40mm · f/8 · ISO 100',
  gs:[
    {t:'林间尽头 · 横',u:'photo-1444492417251-9c84a5fa18e0',ph:['#241610','#D4552E']}
  ],
},
 {d:'2026-07-10',loc:'重庆 · 南滨路',title:'夜航',note:'定影完毕',
  c:'两江交汇的灯,像一艘永不进港的船。长曝四秒,江水把整座城重新冲洗了一遍。',
  exif:'FUJIFILM X-T5 · XF 16-55mm F2.8<br>24mm · f/8 · 4s · ISO 160(三脚架)',
  gs:[
    {t:'夜航 · 全景',u:'photo-1444723121867-7a241cacace9',ph:['#101822','#9BD8CC']},
    {t:'夜航 · 桥',u:'photo-1470004914212-05527e49370b',ph:['#0f1620','#7FB3C4']}
  ],
},
 {d:'2026-07-04',loc:'青岛 · 八大关',title:'暮色四合',note:'定影完毕',
  c:'晚上六点零四分,路灯比晚霞先亮。这座城市的温柔,全写在明暗交接的那条线上。',
  exif:'Leica Q3 · Summilux 28mm<br>28mm · f/1.7 · ISO 100',
  gs:[
    {t:'暮色 · 街',u:'photo-1477959858617-67f85cf4f1df',ph:['#1e1a20','#EFA98A']}
  ],
},
 {d:'2026-06-27',loc:'平遥 · 古城',title:'过客',note:'已入册',
  c:'他推着车从我面前走过,没看镜头。古城每天几千个过客,只有一个成了底片。',
  exif:'Leica M11 · 50mm Summilux<br>50mm · f/1.4 · ISO 64(银盐预设)',
  gs:[
    {t:'过客 · 正片',u:'photo-1506794778202-cad84cf45f1d',ph:['#191919','#8a8a8a']},
    {t:'过客 · 剪影',u:'photo-1449824913935-59a10b8d2000',ph:['#1c1c1c','#7a7a7a']}
  ],
},
 {d:'2026-06-15',loc:'杭州 · 满觉陇',title:'她与光',note:'已入册',
  c:'桂花还没开,光先来了。她说不用看镜头——好,那就让光替她说话。',
  exif:'Canon EOS R6 II · RF 85mm F1.8<br>85mm · f/1.8 · ISO 400',
  gs:[
    {t:'她与光 · 之一',u:'photo-1544005313-94ddf0286df2',ph:['#241c22','#EFA98A']}
  ],
},
 {d:'2026-06-08',loc:'哈尔滨 · 中央大街',title:'北方以北',note:'已入册',
  c:'零下三十度,他把领子立起来,眼里全是雪的反射光。北方人不需要摆姿势。',
  exif:'Nikon Z8 · 35mm f/1.8 S<br>35mm · f/2 · ISO 1600',
  gs:[
    {t:'北方以北 · 街头',u:'photo-1500648767791-00dcc994a43e',ph:['#1a2129','#9BD8CC']}
  ],
},
 {d:'2026-06-03',loc:'天目山 · 禅源寺后山',title:'苔与露',note:'已入册',
  c:'一平方厘米的森林。蹲到膝盖发麻才明白:在苔藓的世界里,一颗露珠就是一场暴雨。',
  exif:'OM SYSTEM OM-1 · 90mm F3.5 Macro<br>90mm · f/5.6 · ISO 800(景深合成 ×12)',
  gs:[
    {t:'苔与露 · 微距',u:'photo-1490750967868-88aa4486c946',ph:['#0f2018','#2FA693']}
  ],
  },
 {d:'2026-06-01',loc:'内蒙古 · 明安图',title:'星轨之下',note:'已入册',
  c:'拍了一整夜,地球替我转了三百六十度。银河落下来的时候,谁都会安静。',
  exif:'SONY α7R V · 14mm F1.8 GM<br>14mm · f/1.8 · 15s × 240 张(星轨堆栈)',
  gs:[
    {t:'星轨 · 堆栈',u:'photo-1419242902214-272b3f66ee7a',ph:['#0b1526','#2FA693']},
    {t:'星轨 · 银河',u:'photo-1435224668334-0f82ec57b605',ph:['#0a1220','#3f7c9c']}
  ]
}
];

/* ─── 云端配置:腾讯云 COS(图片 + 组数据) ─── */
const CONFIG={
  cosBucket:'zhao-1465501838',  /* 存储桶名(控制台可复制) */
  cosRegion:'ap-nanjing',       /* 存储桶所在地域 */
  apiBase:''                    /* 互动接口地址:同源部署留空即可(走相对路径 /api/…);前后端分域时填后端完整域名 */
};

const cosURL=k=>{
  if(!k)return '';
  const key=String(k).split('/').map(encodeURIComponent).join('/');
  if(CONFIG.localSubmissions&&String(k).startsWith('submissions/'))return '/'+key;
  return `https://${CONFIG.cosBucket}.cos.${CONFIG.cosRegion}.myqcloud.com/${key}`;
};

/* ═══════ 预览图压缩 ═══════
   为什么需要:原图单张 12~20MB,访客列表里每张"小图"都在下原图,几十张就卡死。
   做法:上传时在浏览器里把原图压成两个小版本另存到云端,访客只加载小版本:
     · 480px  → 列表/组页缩略图(约 40KB,是原图的 1/300)
     · 1600px → 悬浮窗查看(约 400KB,全屏看也清晰)
   原图保持不动,只在点"下载原图"或长按保存时加载。
   命名:原图 photos/D/1_x.jpg → 小图 photos/D/1_x_t480.jpg / _t1600.jpg
   旧数据没有小图时自动回退原图,不会白屏 */
const Thumb={
  SMALL:480,
  VIEW:1600,
  Q_SMALL:0.82,
  Q_VIEW:0.86,
  /* 由原图 key 派生出小图 key */
  key(k,size){return String(k).replace(/(\.[a-z0-9]+)$/i,'_t'+size+'.jpg')},
  /* 该照片是否有可用小图 */
  has(p){return !!(p&&p.tn&&p.tn.s)},
  /* 把 File/Blob 或已有图片 URL 压成指定长边的小图,返回 Blob */
  async make(src,max,q){
    let bitmap=null,url=null;
    try{
      if(src instanceof Blob){
        /* createImageBitmap 自带 EXIF 方向处理;旧内核回退到 <img> */
        if(window.createImageBitmap){
          try{bitmap=await createImageBitmap(src,{imageOrientation:'from-image'})}catch(e){bitmap=null}
        }
        if(!bitmap)url=URL.createObjectURL(src);
      }else{
        url=src;
      }
      let img=bitmap;
      if(!img){
        img=await new Promise((res,rej)=>{
          const im=new Image();
          /* 跨域图片要带 crossOrigin 才能进 canvas 导出,否则 toBlob 会因污染抛错 */
          if(!/^blob:|^data:/.test(url))im.crossOrigin='anonymous';
          im.onload=()=>res(im);
          im.onerror=()=>rej(new Error('图片读取失败'));
          im.src=url;
        });
      }
      const w0=img.width||img.naturalWidth,h0=img.height||img.naturalHeight;
      if(!w0||!h0)throw new Error('图片尺寸无效');
      const scale=Math.min(1,max/Math.max(w0,h0));
      const w=Math.max(1,Math.round(w0*scale)),h=Math.max(1,Math.round(h0*scale));
      const c=document.createElement('canvas');
      c.width=w;c.height=h;
      const ctx=c.getContext('2d');
      if(!ctx)throw new Error('浏览器暂时无法处理图片，请减小图片或稍后重试');
      /* 缩小图片时开启高质量插值,避免锯齿 */
      if(ctx.imageSmoothingEnabled!==undefined){ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high'}
      /* 白色垫底:PNG 透明区转 JPEG 后不会变黑 */
      ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
      ctx.drawImage(img,0,0,w,h);
      const blob=await new Promise(res=>{
        if(c.toBlob)c.toBlob(res,'image/jpeg',q);
        else{   /* 极老内核回退 dataURL */
          try{
            const d=c.toDataURL('image/jpeg',q);
            const b=atob(d.split(',')[1]);
            const arr=new Uint8Array(b.length);
            for(let i=0;i<b.length;i++)arr[i]=b.charCodeAt(i);
            res(new Blob([arr],{type:'image/jpeg'}));
          }catch(e){res(null)}
        }
      });
      if(!blob)throw new Error('压缩导出失败');
      return blob;
    }finally{
      if(bitmap&&bitmap.close)bitmap.close();
      if(src instanceof Blob&&url&&url.startsWith('blob:'))URL.revokeObjectURL(url);
    }
  },
  /* 为一张照片生成两档小图,返回 {s:key,v:key}(原图 key 不存在时返回 null) */
  async build(k,source){
    if(!k)return null;
    const out={};
    const small=await this.make(source,this.SMALL,this.Q_SMALL);
    out.s=this.key(k,this.SMALL);
    out._smallBlob=small;
    const view=await this.make(source,this.VIEW,this.Q_VIEW);
    out.v=this.key(k,this.VIEW);
    out._viewBlob=view;
    return out;
  }
};

/* 图片 URL:优先生成的小图 → 没有则回退原图(旧数据) */
const pURL=(p,w)=>{
  if(p.k){
    /* 列表(≤600)取 480 小图;中等尺寸取 1600;更大的直接用 1600 兜底 */
    if(p.tn){
      if(w<=600&&p.tn.s)return cosURL(p.tn.s);
      if(p.tn.v)return cosURL(p.tn.v);
    }
    return cosURL(p.k);   /* 无小图:回退原图,行为与旧版一致 */
  }
  return U(p.u,w);
};
/* 打开大图时加载的"查看版":有 1600 小图就用它,否则回退原图 */
const pView=p=>{
  if(p.k){
    if(p.tn&&p.tn.v)return cosURL(p.tn.v);
    return cosURL(p.k);
  }
  return U(p.u,document.documentElement.classList.contains('lite')?1200:2400);
};
/* 原图:只在"下载/长按保存"时使用,访客平常浏览不会加载 */
const pFull=p=>{
  if(p.k)return cosURL(p.k);
  return U(p.u,document.documentElement.classList.contains('lite')?1200:2400);
};

/* ─── 数据仓库:优先读 COS 上的 data.json,读不到用内置演示数据 ─── */
const Store={
  groups:[],
  remote:false,
  normalizeGroup(raw){
    if(!raw||typeof raw!=='object')return null;
    const d=String(raw.d||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return null;
    const gs=Array.isArray(raw.gs)?raw.gs.filter(p=>p&&typeof p==='object').map(p=>({...p,t:String(p.t||'作品')})):[];
    return {...raw,d,loc:String(raw.loc||'—'),title:String(raw.title||'未命名组'),gs};
  },
  async init(){
    if(CONFIG.cosBucket){
      for(let attempt=0;attempt<2;attempt++){
        try{
          const r=await fetchWithTimeout(`https://${CONFIG.cosBucket}.cos.${CONFIG.cosRegion}.myqcloud.com/data.json`,{cache:'no-store'},9000);
          if(r.ok){
            const d=await r.json();
            if(d&&Array.isArray(d.groups)){
              const groups=d.groups.map(g=>this.normalizeGroup(g)).filter(Boolean);
              this.groups=groups;
              this.remote=true;
              return true;
            }
          }
        }catch(e){}
      }
    }
    return false;
  },
  setDemo(){
    this.groups=DEMO_GROUPS.slice();
    this.remote=false;
  }
};

const YEARS=()=>[...new Set(Store.groups.map(g=>g.d.slice(0,4)))].sort().reverse();
const monthsOf=y=>[...new Set(Store.groups.filter(g=>g.d.startsWith(y)).map(g=>g.d.slice(0,7)))].sort().reverse();
const daysOf=ym=>Store.groups.filter(g=>g.d.startsWith(ym)).sort((a,b)=>b.d.localeCompare(a.d));
const groupOf=d=>Store.groups.find(g=>g.d===d);
const totalPhotos=()=>Store.groups.reduce((s,g)=>s+g.gs.length,0);
const WEEK=['日','一','二','三','四','五','六'];
const dayCn=d=>{const dt=new Date(d+'T00:00:00');return WEEK[dt.getDay()]};

/* ─── 访客昵称(随机分配,可改名) ─── */
/* ─── 访客身份:随机名字 + 12 款预设头像(几何艺术风,纯 SVG 零请求) ─── */
const Avatar={
  /* 12 款头像定义:底色 + 图形 + 前景色。纯字符生成,不请求任何图片 */
  list:[
    {id:'a1', bg:'#FF6B6B', fg:'#FFF3E6', shape:'circle'},
    {id:'a2', bg:'#4ECDC4', fg:'#0B2B29', shape:'tri'},
    {id:'a3', bg:'#FFD166', fg:'#4A3410', shape:'square'},
    {id:'a4', bg:'#A78BFA', fg:'#1E1635', shape:'diamond'},
    {id:'a5', bg:'#06D6A0', fg:'#05372A', shape:'ring'},
    {id:'a6', bg:'#FF9F68', fg:'#4A2410', shape:'wave'},
    {id:'a7', bg:'#5B8DEF', fg:'#0D1F45', shape:'circle'},
    {id:'a8', bg:'#F472B6', fg:'#4A1030', shape:'tri'},
    {id:'a9', bg:'#34D399', fg:'#052E22', shape:'diamond'},
    {id:'a10',bg:'#FBBF24', fg:'#493307', shape:'ring'},
    {id:'a11',bg:'#818CF8', fg:'#171A4A', shape:'wave'},
    {id:'a12',bg:'#FB7185', fg:'#4A0F1C', shape:'square'}
  ],
  find(id){return this.list.find(a=>a.id===id)||this.list[0]},
  /* 生成头像 SVG 字符串。头像图形固定、尺寸只有几种,用缓存避免重复拼字符串
     (评论列表每次刷新都要为每条评论重建头像,不缓存会反复做字符串拼接) */
  _cache:{},
  svg(id,size){
    const a=this.find(id),s=size||40;
    const ck=a.id+'@'+s;
    if(this._cache[ck])return this._cache[ck];
    let inner='';
    switch(a.shape){
      case 'circle': inner=`<circle cx="20" cy="20" r="9" fill="${a.fg}"/>`; break;
      case 'tri':    inner=`<path d="M20 10l9 16H11z" fill="${a.fg}"/>`; break;
      case 'square': inner=`<rect x="11" y="11" width="18" height="18" rx="3" fill="${a.fg}"/>`; break;
      case 'diamond':inner=`<path d="M20 9l11 11-11 11-11-11z" fill="${a.fg}"/>`; break;
      case 'ring':   inner=`<circle cx="20" cy="20" r="9.5" fill="none" stroke="${a.fg}" stroke-width="4.5"/>`; break;
      case 'wave':   inner=`<path d="M8 22c4-8 8 8 12 0s8 8 12 0" fill="none" stroke="${a.fg}" stroke-width="4" stroke-linecap="round"/>`; break;
    }
    const out=`<svg viewBox="0 0 40 40" width="${s}" height="${s}" aria-hidden="true">`+
           `<rect width="40" height="40" rx="20" fill="${a.bg}"/>${inner}</svg>`;
    this._cache[ck]=out;
    return out;
  }
};

const Identity={
  A:['追光','雾中','慢门','胶片','逆光','林间','暖调','显影','银盐','午后','山野','深空','拾光','静物'],
  B:['客','旅人','学徒','观察员','诗人','路过','拾光人','收藏家','手艺人','漫游者'],
  nick:'',avatar:'',id:'',
  gen(){return this.A[Math.random()*this.A.length|0]+this.B[Math.random()*this.B.length|0]},
  genId(){return 'v_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10)},
  init(){
    this.nick=storageGet('pt_nick');
    this.avatar=storageGet('pt_avatar');
    this.id=storageGet('pt_vid');
    if(!this.nick){this.nick=this.gen()}
    if(!this.avatar){this.avatar=Avatar.list[Math.random()*Avatar.list.length|0].id}
    if(!this.id){this.id=this.genId()}
    this.save();
  },
  save(){
    storageSet('pt_nick',this.nick);
    storageSet('pt_avatar',this.avatar);
    storageSet('pt_vid',this.id);
  },
  /* 提交给后端的身份包 */
  pack(){return {id:this.id,name:this.nick,avatar:this.avatar}},
  setName(n){
    const v=String(n||'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,24);
    if(v)this.nick=v;
    this.save();
  },
  setAvatar(id){if(Avatar.find(id))this.avatar=id;this.save()}
};

/* ─── 轻量事件总线:模块解耦(如上传完成 → archive:reload,Admin 不再直调 Store/Archive) ─── */
const Bus={
  m:{},
  on(t,f){(this.m[t]=this.m[t]||[]).push(f)},
  emit(t,d){return Promise.all((this.m[t]||[]).slice().map(f=>{try{return f(d)}catch(e){}}))}
};

/* ─── 互动:单张照片的点赞与评论(数据由后端存进腾讯云 COS) ─── */
const Social={
  data:{photos:{}},      /* 全站互动数据缓存 */
  ready:false,           /* 是否已成功连上后端 */
  g:null,p:null,         /* 当前悬浮窗正在看的照片 */
  talkG:null,            /* 当前组详情页正在看的组(组留言用) */
  avatarsPainted:false,

  /* 后端地址:同源部署时留空即可(相对路径);本地分离调试时可在 CONFIG 里改 */
  base(){return (CONFIG.apiBase||'').replace(/\/+$/,'')},

  /* 照片的稳定唯一标识:优先用 COS 对象 key,演示图用 日期#UnsplashID
     未打开任何照片时(g/p 为空)返回空串,由调用方跳过绘制 */
  key(g,p){
    if(!p)return '';
    return p.k||((g&&g.d)?(g.d+'#'+(p.u||p.t)):(p.u||p.t||'unknown'));
  },

  /* 组的稳定唯一标识:留言挂在"这一组"上,与单张照片的评论分开存放。
     日期是组的唯一键,加 grp: 前缀避免与照片 key(COS 路径)冲突。
     空组照样有 key,所以没有照片的组也能留言 */
  talkKey(g){return g&&g.d?('grp:'+g.d):''},

  async init(){
    Identity.init();
    this.bindUI();
    this.paintMe();
    this.setOffline(true);
    // 点开作品或组页后再读取当前互动记录。
  },

  async call(path,opts){
    const r=await fetchWithTimeout(this.base()+path,opts,12000);
    let j=null;
    try{j=await r.json()}catch(e){}
    if(!r.ok)throw new Error((j&&j.error)||('请求失败 '+r.status));
    return j;
  },

  async load(key){
    try{
      const incoming=await this.call('/api/interactions?vid='+encodeURIComponent(Identity.id)+(key?'&key='+encodeURIComponent(key):''));
      Object.assign(this.data.photos,incoming&&incoming.photos||{});
      if(!this.data||!this.data.photos)this.data={photos:{}};
      this.data.photos=Object.assign(Object.create(null),this.data.photos);
      this.ready=true;
      this._retry=0;
      this.setOffline(false);
      this.refresh();
      /* 数据可能在组详情页打开着的时候才到位(冷启动重试),组留言区也要跟着刷新 */
      if(this.talkG)this.refreshTalk();
    }catch(e){
      this.ready=false;
      this.setOffline(true);
      /* 网络抖动/后端冷启动时自动重试,最多 4 次(2s/5s/10s/20s),不让互动区长期停摆 */
      this._retry=(this._retry||0)+1;
      if(this._retry<=4){
        const wait=[2000,5000,10000,20000][this._retry-1];
        setTimeout(()=>this.load(key),wait);
      }
    }
  },

  /* 离线状态单独呈现:不占用评论区那行提示,避免与"已发布/失败"互相覆盖 */
  setOffline(off){
    this.offline=!!off;
    /* 照片评论区与组留言区的输入控件一起管控 */
    const inp=$('#cmInput'),btn=$('#cmSend');
    if(inp)inp.disabled=off;
    if(btn)btn.disabled=off||!!btn.dataset.sending;
    const gi=$('#gtInput'),gb=$('#gtSend');
    if(gi)gi.disabled=off;
    if(gb)gb.disabled=off||!!gb.dataset.sending;
    const lb=$('#likeBtn');
    if(lb)lb.disabled=off;
    const h=$('#cmHint');
    if(h&&off&&!h.dataset.keep)h.textContent='互动功能正在连接中,稍候即可点赞留言…';
    if(h&&!off&&!h.dataset.keep)h.textContent='';
    this.setTalkHint('');   /* 组留言区的连接提示随之切换 */
  },

  /* 取某张照片的记录(总是返回可用对象,不改动缓存) */
  rec(key){
    const p=this.data.photos[key];
    return {likes:(p&&p.likes)||[],comments:(p&&p.comments)||[]};
  },

  /* 当前访客是否已赞 */
  isLiked(key){
    return this.rec(key).likes.some(l=>isMine(l));
  },

  /* ─── 悬浮窗切图时刷新互动区 ─── */
  bind(g,p){
    this.g=g;this.p=p;
    this.refresh();
    this.load(this.key(g,p));
    /* 输入框:属于「当前这张照片」,切图时清空防止误发到别的照片 */
    const inp=$('#cmInput');
    if(inp)inp.value='';
  },

  /* ─── 组详情页:绑定当前组,刷新组留言 ─── */
  bindGroup(g){
    this.talkG=g;
    this.refreshTalk();
    this.load(this.talkKey(g));
    const inp=$('#gtInput');
    if(inp)inp.value='';
  },

  refresh(){
    const key=this.key(this.g,this.p);
    if(!key)return;
    const rec=this.rec(key);
    const liked=this.isLiked(key);

    /* 变更检测:数据没变就整段跳过 DOM 操作
       (切图时 refresh 会被调用,若每次都重建评论列表会白白引发重排) */
    const sig=key+'|'+(liked?'1':'0')+'|'+rec.likes.length+'|'+rec.comments.length+
      '|'+(rec.comments.length?rec.comments[rec.comments.length-1].id:'')+
      '|'+Identity.nick+'|'+Identity.avatar;
    if(sig===this._sig)return;
    this._sig=sig;

    const btn=$('#likeBtn');
    if(btn){
      btn.classList.toggle('on',liked);
      btn.setAttribute('aria-pressed',liked?'true':'false');
      btn.setAttribute('aria-label',liked?'取消点赞':'点赞这张照片');
    }
    const cnt=$('#likeCount');
    if(cnt)cnt.textContent=String(rec.likes.length);

    this.paintFaces(rec.likes);
    this.paintComments(key,rec.comments);
    this.paintMe();
  },

  /* ─── 组留言区刷新:与照片评论同一套渲染,只是换了个 key 与容器 ─── */
  refreshTalk(){
    const g=this.talkG;
    const key=this.talkKey(g);
    if(!key)return;
    const rec=this.rec(key);
    const sig=key+'|'+rec.comments.length+
      '|'+(rec.comments.length?rec.comments[rec.comments.length-1].id:'')+
      '|'+Identity.nick+'|'+Identity.avatar;
    if(sig===this._talkSig)return;
    this._talkSig=sig;
    this.paintComments(key,rec.comments,{list:'#gtList',count:'#gtCount',
      empty:'暂无留言'});
    /* 组留言区也显示当前身份(名字+头像),与照片评论区同一套来源 */
    const av=$('#gtMeAv'),nm=$('#gtMeName');
    if(av)av.innerHTML=Avatar.svg(Identity.avatar,26);
    if(nm)nm.textContent=Identity.nick;
  },

  /* 谁赞了:最多显示 6 个小头像,超出显示 +N */
  paintFaces(likes){
    const box=$('#likeFaces');
    if(!box)return;
    const list=(likes||[]).slice(-6).reverse();
    let html=list.map(l=>`<span class="lf" title="${esc(l.name||'')}">${Avatar.svg(l.avatar,22)}</span>`).join('');
    const more=(likes||[]).length-list.length;
    if(more>0)html+=`<span class="lf-more">+${more}</span>`;
    box.innerHTML=html;
  },

  /* 评论列表。第二组参数可指定挂载容器(组留言复用同一套渲染);
     不传时沿用悬浮窗里的照片评论区 */
  paintComments(key,comments,opt){
    const o=opt||{};
    const box=$(o.list||'#cmList'),cnt=$(o.count||'#cmCount');
    if(cnt)cnt.textContent=String((comments||[]).length);
    if(!box)return;
    /* dataset.key 让删除按钮知道这条评论挂在哪(照片 key 还是组 key) */
    box.dataset.key=key;
    if(!comments||!comments.length){
      box.innerHTML=`<div class="cm-empty">${o.empty||'暂无留言'}</div>`;
      return;
    }
    box.innerHTML=comments.slice().reverse().map(c=>{
      const own=c.mine===true||c.visitorId===Identity.id;
      return `<div class="cm-item" data-id="${esc(c.id)}">
        <span class="cm-av">${Avatar.svg(c.avatar,28)}</span>
        <div class="cm-body">
          <div class="cm-top">
            <span class="cm-name">${esc(c.name||'匿名的追光者')}</span>
            <span class="cm-time">${this.ago(c.ts)}</span>
            ${own?'<button type="button" class="cm-del" data-act="del">删除</button>':''}
          </div>
          <div class="cm-text">${esc(c.text||'')}</div>
        </div>
      </div>`;
    }).join('');
  },

  /* 相对时间 */
  ago(ts){
    const d=Date.now()-(ts||0);
    if(d<60000)return '刚刚';
    if(d<3600000)return Math.floor(d/60000)+' 分钟前';
    if(d<86400000)return Math.floor(d/3600000)+' 小时前';
    if(d<2592000000)return Math.floor(d/86400000)+' 天前';
    const dt=new Date(ts);
    return (dt.getMonth()+1)+'月'+dt.getDate()+'日';
  },

  /* 身份条 */
  paintMe(){
    const av=$('#meAv'),nm=$('#meName');
    if(av)av.innerHTML=Avatar.svg(Identity.avatar,26);
    if(nm)nm.textContent=Identity.nick;
    const gi=$('#avGrid');
    if(gi&&!this.avatarsPainted){
      gi.innerHTML=Avatar.list.map(a=>
        `<span class="av-opt${a.id===Identity.avatar?' sel':''}" data-av="${a.id}" title="选择这个头像">${Avatar.svg(a.id,40)}</span>`
      ).join('');
      this.avatarsPainted=true;
    }
    const grid=$('#avGrid');
    if(grid){
      grid.querySelectorAll('.av-opt').forEach(el=>{
        el.classList.toggle('sel',el.dataset.av===Identity.avatar);
      });
    }
    const mi=$('#meInput');
    if(mi&&document.activeElement!==mi)mi.value=Identity.nick;
  },

  /* 操作反馈提示(发送中/已发布/失败)。离线连接提示由 setOffline 单独管理,两者不互相覆盖 */
  setHint(t,err){
    const h=$('#cmHint');
    if(!h)return;
    if(t){
      h.dataset.keep='1';          /* 有真实反馈时,接管这一行 */
      h.textContent=t;
      h.classList.toggle('err',!!err);
    }else{
      delete h.dataset.keep;
      /* 无反馈可显示时,若仍处离线态就恢复连接提示 */
      h.textContent=this.offline?'互动功能正在连接中,稍候即可点赞留言…':'';
      h.classList.toggle('err',false);
    }
  },

  /* ─── 交互绑定(一次性) ─── */
  bindUI(){
    /* 点赞 */
    const lb=$('#likeBtn');
    if(lb&&!lb.dataset.bound){
      lb.dataset.bound='1';
      lb.addEventListener('click',()=>this.toggleLike());
    }
    /* 发送评论 */
    const send=$('#cmSend');
    if(send&&!send.dataset.bound){
      send.dataset.bound='1';
      send.addEventListener('click',()=>this.postComment());
    }
    const inp=$('#cmInput');
    if(inp&&!inp.dataset.bound){
      inp.dataset.bound='1';
      inp.addEventListener('keydown',e=>{
        if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();this.postComment()}
      });
      /* 输入时自动长高(不超过 110px) */
      inp.addEventListener('input',()=>{
        inp.style.height='auto';
        inp.style.height=Math.min(110,Math.max(42,inp.scrollHeight))+'px';
      });
    }
    /* 身份编辑面板开关 */
    const ed=$('#meEdit');
    if(ed&&!ed.dataset.bound){
      ed.dataset.bound='1';
      ed.addEventListener('click',()=>{
        const pn=$('#mePanel');
        if(!pn)return;
        pn.hidden=!pn.hidden;
        ed.textContent=pn.hidden?'改名字':'收起';
        if(!pn.hidden){this.paintMe();const mi=$('#meInput');if(mi)mi.focus()}
      });
    }
    /* 头像选择 */
    const grid=$('#avGrid');
    if(grid&&!grid.dataset.bound){
      grid.dataset.bound='1';
      grid.addEventListener('click',e=>{
        const el=e.target.closest('.av-opt');
        if(!el)return;
        Identity.setAvatar(el.dataset.av);
        this.paintMe();
      });
    }
    /* 换个名字 */
    const rb=$('#meRandom');
    if(rb&&!rb.dataset.bound){
      rb.dataset.bound='1';
      rb.addEventListener('click',()=>{
        const mi=$('#meInput');
        if(mi)mi.value=Identity.gen();
      });
    }
    /* 保存身份 */
    const sv=$('#meSave');
    if(sv&&!sv.dataset.bound){
      sv.dataset.bound='1';
      sv.addEventListener('click',()=>{
        const mi=$('#meInput');
        Identity.setName(mi?mi.value:Identity.nick);
        this.paintMe();
        const pn=$('#mePanel');
        if(pn)pn.hidden=true;
        const ed2=$('#meEdit');
        if(ed2)ed2.textContent='改名字';
        this.setHint('已保存你的名字与头像');
        /* 名字/头像变了,已发的评论与点赞仍归属同一身份,只需重绘画像与列表 */
        this.refresh();
      });
    }
    /* 删除自己的评论 */
    const list=$('#cmList');
    if(list&&!list.dataset.bound){
      list.dataset.bound='1';
      list.addEventListener('click',e=>{
        const d=e.target.closest('[data-act="del"]');
        if(!d)return;
        const item=d.closest('.cm-item');
        if(item)this.deleteComment(item.dataset.id);
      });
    }
    /* ─── 组留言:发送 / 回车 / 删除,与照片评论同形,只是 key 换成组 key ─── */
    const gsend=$('#gtSend');
    if(gsend&&!gsend.dataset.bound){
      gsend.dataset.bound='1';
      gsend.addEventListener('click',()=>this.postTalk());
    }
    const ginp=$('#gtInput');
    if(ginp&&!ginp.dataset.bound){
      ginp.dataset.bound='1';
      ginp.addEventListener('keydown',e=>{
        if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();this.postTalk()}
      });
      ginp.addEventListener('input',()=>{
        ginp.style.height='auto';
        ginp.style.height=Math.min(110,Math.max(42,ginp.scrollHeight))+'px';
      });
    }
    const glist=$('#gtList');
    if(glist&&!glist.dataset.bound){
      glist.dataset.bound='1';
      glist.addEventListener('click',e=>{
        const d=e.target.closest('[data-act="del"]');
        if(!d)return;
        const item=d.closest('.cm-item');
        if(item)this.deleteComment(item.dataset.id,this.talkKey(this.talkG));
      });
    }
    /* 失焦自动保存名字(体验更顺,不用特意点保存) */
    const mi=$('#meInput');
    if(mi&&!mi.dataset.blurBound){
      mi.dataset.blurBound='1';
      mi.addEventListener('blur',()=>{
        if(mi.value.trim()&&mi.value.trim()!==Identity.nick){
          Identity.setName(mi.value);
          this.paintMe();
        }
      });
    }
  },

  /* ─── 点赞 / 取消:乐观更新(点下去立刻亮,再与服务器对账) ─── */
  async toggleLike(){
    const key=this.key(this.g,this.p);
    if(!key)return;
    const btn=$('#likeBtn');
    if(btn&&btn.dataset.busy)return;
    if(btn)btn.dataset.busy='1';

    /* ① 先改本地:界面即时响应,不等网络 */
    const rec=this.data.photos[key]||(this.data.photos[key]={likes:[],comments:[]});
    const wasLiked=rec.likes.some(l=>isMine(l));
    if(wasLiked){
      rec.likes=rec.likes.filter(l=>l&&!isMine(l));
    }else{
      rec.likes.push({id:Identity.id,name:Identity.nick,avatar:Identity.avatar,ts:Date.now()});
    }
    this.refresh();
    if(!wasLiked&&btn){
      btn.classList.add('pop');
      setTimeout(()=>btn.classList.remove('pop'),440);
    }

    /* ② 再与服务器对账:失败则回滚 */
    try{
      const r=await this.call('/api/like',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({key:key,visitor:Identity.pack()})
      });
      const cur=this.data.photos[key]||(this.data.photos[key]={likes:[],comments:[]});
      const mine=cur.likes.filter(l=>isMine(l));
      if(r.liked){
        /* 服务器认为已赞:本地若还没有(或有多条)就补正为一条 */
        if(mine.length!==1){
          cur.likes=cur.likes.filter(l=>l&&!isMine(l));
          cur.likes.push({id:Identity.id,name:Identity.nick,avatar:Identity.avatar,ts:Date.now()});
        }
      }else{
        cur.likes=cur.likes.filter(l=>l&&!isMine(l));
      }
      this.ready=true;
      this.setOffline(false);
      this._retry=0;
      this.setHint('');
      this.refresh();
    }catch(e){
      /* 回滚到点击前的状态 */
      const cur=this.data.photos[key];
      if(cur){
        const has=cur.likes.some(l=>isMine(l));
        if(wasLiked&&!has){
          cur.likes.push({id:Identity.id,name:Identity.nick,avatar:Identity.avatar,ts:Date.now()});
        }else if(!wasLiked&&has){
          cur.likes=cur.likes.filter(l=>l&&!isMine(l));
        }
      }
      this.setHint('点赞没成功,请检查网络后重试',true);
      this.refresh();
    }finally{
      if(btn)btn.dataset.busy='';
    }
  },

  /* ─── 发表评论 / 组留言:同一套提交流程,只有 key、输入框与刷新目标不同 ─── */
  async postComment(){
    const key=this.key(this.g,this.p);
    return this._post(key,{inp:'#cmInput',btn:'#cmSend',hint:this.setHint.bind(this),after:()=>this.refresh()});
  },

  /* 组留言:key 用 grp:日期,留言挂在整组上(空组也能留) */
  async postTalk(){
    const key=this.talkKey(this.talkG);
    return this._post(key,{inp:'#gtInput',btn:'#gtSend',
      hint:(t,err)=>this.setTalkHint(t,err),after:()=>this.refreshTalk()});
  },

  async _post(key,ui){
    if(!key)return;
    const inp=$(ui.inp),btn=$(ui.btn);
    if(!this.ready||btn&&btn.dataset.sending)return;
    const current=()=>ui.inp==='#gtInput'?this.talkKey(this.talkG)===key:this.key(this.g,this.p)===key;
    const text=(inp&&inp.value||'').trim();
    if(!text){ui.hint('请先写点什么再发送',true);return}
    if(btn){btn.disabled=true;btn.dataset.sending='1'}
    ui.hint('发送中…');
    try{
      const r=await this.call('/api/comment',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({key:key,visitor:Identity.pack(),text:text})
      });
      const rec=this.data.photos[key]||(this.data.photos[key]={likes:[],comments:[]});
      rec.comments.push(r.comment);
      this.ready=true;
      this.setOffline(false);
      if(current()&&inp&&inp.value.trim()===text){inp.value='';inp.style.height=''}
      if(current()){ui.hint('已发布');setTimeout(()=>{if(current())ui.hint('')},2200)}
      ui.after();
    }catch(e){
      if(current())ui.hint('发送失败:'+e.message,true);
    }finally{
      if(btn){delete btn.dataset.sending;btn.disabled=!!this.offline}
    }
  },

  /* 组留言区的连接/操作提示(与照片评论区的 setHint 分开,互不覆盖) */
  setTalkHint(t,err){
    const h=$('#gtHint');
    if(!h)return;
    h.textContent=t||(this.offline?'互动功能正在连接中,稍候即可留言…':'');
    h.classList.toggle('err',!!err);
  },

  /* ─── 删除自己的评论(本地即时移除 + 后端记录)
     talkKey 传入时删的是组留言,否则删当前照片的评论 ─── */
  async deleteComment(id,talkKey){
    const key=talkKey||this.key(this.g,this.p);
    if(!key||!id||this._deleting===id)return;
    this._deleting=id;
    try{
      await this.call('/api/comment/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,id,visitor:Identity.pack()})});
      const rec=this.data.photos[key];
      if(rec)rec.comments=rec.comments.filter(c=>c&&c.id!==id);
      if(talkKey)this.refreshTalk();else this.refresh();
    }catch(error){
      if(talkKey)this.setTalkHint('删除失败：'+error.message,true);else this.setHint('删除失败：'+error.message,true);
    }finally{this._deleting=null}
  }

};

/* ─── 摄影评选投票模块 (Exhibition Ballot) ─── */
const Vote={
  config:null,
  selectedKeys:[],
  userVoted:false,
  votedKeys:[],
  votedKey:null,

  getMaxVotes(){
    return (this.config&&this.config.maxVotes)?Math.max(1,parseInt(this.config.maxVotes,10)||1):1;
  },

  async init(){
    this.bindUI();
    await this.fetchStatus();
  },

  async fetchStatus(){
    try{
      const r=await fetchWithTimeout((CONFIG.apiBase||'')+'/api/vote/config?vid='+encodeURIComponent(Identity.id||''),{cache:'no-store'},10000);
      if(!r.ok)throw new Error('活动信息暂时不可用');
      const j=await r.json();
      if(this.config&&this.config.eventId!==j.eventId)this.selectedKeys=[];
      this.config=j;
      this.userVoted=Boolean(j.userVoted);
      this.votedKeys=Array.isArray(j.votedKeys)?j.votedKeys:(j.votedKey?[j.votedKey]:[]);
      this.votedKey=this.votedKeys[0]||null;
      this.applyVisibility();
    }catch(e){}
  },

  /* 控制弹窗与顶栏入口显隐:到期/关闭时自动完全隐退 */
  applyVisibility(){
    const topBadge=$('#topVoteBadge');
    if(!this.config||!this.config.enabled||this.config.isExpired){
      if(topBadge)topBadge.hidden=true;
      const modal=$('#voteNoticeModal');if(modal)modal.hidden=true;
      const board=$('#voteBoardModal');if(board)board.hidden=true;
      return;
    }
    // 活动进行中: 显示顶栏礼品徽章
    if(topBadge)topBadge.hidden=false;

  },

  openNotice(){
    if(!this.config||!this.config.enabled)return;
    const m=$('#voteNoticeModal');
    if(!m)return;
    const max=this.getMaxVotes();
    $('#vmNoticeTitle').textContent=this.config.title||'最美光影瞬间评选';
    $('#vmNoticeDeadline').textContent='⏱ 截止时间: '+(this.config.deadline||'进行中');
    $('#vmNoticeRules').textContent=this.config.rules||(max>1?`每位访客最多可挑选 ${max} 张心动的作品。请在投票时附上联系 QQ，活动截止后站长将联系得票最高作品的投票者赠送精美纪念礼！`:'每位访客限投一张你最心动的照片。请在投票时附上你的真实联系 QQ，活动截止后站长将联系得票最高作品的投票者赠送精美摄影纪念画册！');
    const rw=$('#vmNoticeReward');
    if(rw){
      rw.textContent=this.config.reward?('参与纪念：'+this.config.reward):'';
      rw.hidden=!this.config.reward;
    }
    const subBtn=$('#vmNoticeSub');
    if(subBtn){
      const subOn=Submission&&Submission.config&&Submission.config.enabled&&!Submission.config.isExpired;
      subBtn.hidden=!subOn;
    }
    m.hidden=false;
    document.body.style.overflow='hidden';
  },

  closeNotice(){
    const m=$('#voteNoticeModal');
    if(m)m.hidden=true;
    if($('#voteBoardModal').hidden)document.body.style.overflow='';
  },

  /* 打开全屏投票选片画板 */
  openBoard(){
    this.closeNotice();
    const b=$('#voteBoardModal');
    if(!b)return;
    b.hidden=false;
    document.body.style.overflow='hidden';
    const max=this.getMaxVotes();
    $('#vbTitle').textContent=this.config.title||'摄影作品评选';
    const tag=$('.vb-tag');
    if(tag)tag.textContent=max>1?`每人最多 ${max} 票`:'每人限投 1 票';
    const sub=$('#vbSub');
    if(sub)sub.textContent=`每人每期一次，可选 1~${max} 张作品`;
    $('#vbRules').textContent=(this.config.rules||'')+(this.config.reward?'\n\n参与纪念：'+this.config.reward:'')+(this.config.deadline?'\n\n截止时间：'+this.config.deadline+'（北京时间）':'');
    this.renderGrid();
    this.updateBar();
  },

  closeBoard(){
    const b=$('#voteBoardModal');
    if(b)b.hidden=true;
    document.body.style.overflow='';
  },

  photoKey(g,p){
    if(!p)return '';
    return p.k||((g&&g.d)?(g.d+'#'+(p.u||p.t)):(p.u||p.t||'unknown'));
  },

  /* 平铺全站照片网格 (真实照片与演示照片均可参选) */
  renderGrid(){
    const grid=$('#vbGrid');
    if(!grid)return;
    const all=[];
    (Store.groups||[]).forEach(g=>{
      (g.gs||[]).forEach(p=>{
        if(p.k||p.u)all.push({p,g,key:this.photoKey(g,p)});
      });
    });
    if(!all.length){
      grid.innerHTML='<div class="cm-empty">画廊作品载入中,请稍候片刻…</div>';
      return;
    }
    grid.innerHTML=all.map(({p,g,key})=>{
      const isSel=this.userVoted?this.votedKeys.includes(key):this.selectedKeys.includes(key);
      return `
      <div class="vb-card${isSel?' selected':''}" data-key="${esc(key)}" tabindex="0" role="button" aria-pressed="${isSel?'true':'false'}" aria-label="选择 ${esc(p.t)}">
        <div class="vb-badge-sel">✓</div>
        <div class="vb-thumb"><img src="${safeUrl(pURL(p,480))}" alt="${esc(p.t)}" loading="lazy" decoding="async"></div>
        <div class="vb-card-t">${esc(p.t||g.title)}</div>
      </div>`;
    }).join('');
  },

  updateBar(){
    const thumb=$('#vbPickThumb'),title=$('#vbPickTitle'),sub=$('#vbPickSub');
    const submitBtn=$('#vbSubmit'),qqInput=$('#vbQQ'),hint=$('#vbHint');
    const max=this.getMaxVotes();

    if(qqInput)qqInput.disabled=this.userVoted||!!this._submitting;
    if(this.userVoted){
      if(title)title.textContent=`你已完成投票 (已选 ${this.votedKeys.length} 张)`;
      if(sub)sub.textContent='每位访客限参与一次 · 感谢你的参与！';
      if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='已投票';}
      if(qqInput)qqInput.disabled=true;
      if(hint)hint.textContent='评选截止后站长将联系得奖者';
      return;
    }
    if(!this.selectedKeys.length){
      if(thumb)thumb.innerHTML='';
      if(title)title.textContent='未选择照片';
      if(sub)sub.textContent=max>1?`请在上方点击卡片挑选 (最多可选 ${max} 张)`:'请在上方点击卡片挑选你最爱的一张';
      if(submitBtn){submitBtn.disabled=true;submitBtn.textContent=max>1?`确认投票 (0/${max} 张)`:'确认投这一张';}
    }else{
      const foundList=[];
      this.selectedKeys.forEach(k=>{
        (Store.groups||[]).some(g=>(g.gs||[]).some(p=>{
          if(this.photoKey(g,p)===k){foundList.push({p,g});return true;}
        }));
      });
      if(thumb){
        if(foundList.length===1){
          thumb.innerHTML=`<img src="${safeUrl(pURL(foundList[0].p,300))}" alt="">`;
        }else if(foundList.length>1){
          thumb.innerHTML=`<div style="display:flex;gap:2px;width:100%;height:100%;align-items:center;overflow:hidden">${foundList.slice(0,3).map(f=>`<img src="${safeUrl(pURL(f.p,300))}" style="width:calc(33.3% - 2px);height:100%;object-fit:cover;border-radius:3px" alt="">`).join('')}</div>`;
        }
      }
      if(title){
        if(max===1&&foundList[0]){
          title.textContent=foundList[0].p.t||foundList[0].g.title;
        }else{
          title.textContent=`已选择 ${this.selectedKeys.length} / ${max} 张作品`;
        }
      }
      if(sub){
        if(max===1&&foundList[0]){
          sub.textContent=`来自《${foundList[0].g.title}》· 输入QQ完成投票`;
        }else{
          sub.textContent=`最多可选 ${max} 张 · 输入QQ完成投票`;
        }
      }
      if(submitBtn){
        submitBtn.textContent=max>1?`确认投票 (${this.selectedKeys.length}/${max} 张)`:'确认投这一张';
        submitBtn.disabled=!!this._submitting||!this.checkQQ()||this.selectedKeys.length===0||this.selectedKeys.length>max;
      }
    }
  },

  checkQQ(){
    const qq=($('#vbQQ')?$('#vbQQ').value:'').trim();
    return /^\d{5,13}$/.test(qq);
  },

  bindUI(){
    const tb=$('#topVoteBadge');
    if(tb&&!tb.dataset.bound){
      tb.dataset.bound='1';
      tb.addEventListener('click',()=>this.openBoard());
    }
    const vclose=$('#vmNoticeClose'),vskip=$('#vmNoticeLater'),vgo=$('#vmNoticeGo'),vsub=$('#vmNoticeSub');
    if(vclose)vclose.addEventListener('click',()=>this.closeNotice());
    if(vskip)vskip.addEventListener('click',()=>this.closeNotice());
    if(vgo)vgo.addEventListener('click',()=>this.openBoard());
    if(vsub)vsub.addEventListener('click',()=>{this.closeNotice();Submission.openBoard()});
    $('#vmNoticeMask')?.addEventListener('click',()=>this.closeNotice());

    $('#vbClose')?.addEventListener('click',()=>this.closeBoard());
    $('#vbMask')?.addEventListener('click',()=>this.closeBoard());

    const grid=$('#vbGrid');
    if(grid&&!grid.dataset.bound){
      grid.dataset.bound='1';
      grid.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.closest('.vb-card')){event.preventDefault();event.target.closest('.vb-card').click()}});
      grid.addEventListener('click',e=>{
        if(this.userVoted||this._submitting)return;
        const card=e.target.closest('.vb-card');
        if(!card)return;
        const k=card.dataset.key;
        if(!k)return;
        const max=this.getMaxVotes();
        const idx=this.selectedKeys.indexOf(k);
        const hint=$('#vbHint');

        if(idx>-1){
          this.selectedKeys.splice(idx,1);
          if(hint){hint.textContent='';hint.className='vb-hint';}
        }else{
          if(max===1){
            this.selectedKeys=[k];
            if(hint){hint.textContent='';hint.className='vb-hint';}
          }else{
            if(this.selectedKeys.length>=max){
              if(hint){
                hint.textContent=`最多可选 ${max} 张照片，可点击已选照片取消选择`;
                hint.className='vb-hint err';
              }
              return;
            }
            this.selectedKeys.push(k);
            if(hint){hint.textContent='';hint.className='vb-hint';}
          }
        }
        grid.querySelectorAll('.vb-card').forEach(c=>{const selected=this.selectedKeys.includes(c.dataset.key);c.classList.toggle('selected',selected);c.setAttribute('aria-pressed',String(selected))});
        this.updateBar();
      });
    }

    const qqInp=$('#vbQQ');
    if(qqInp&&!qqInp.dataset.bound){
      qqInp.dataset.bound='1';
      qqInp.addEventListener('input',()=>{
        const btn=$('#vbSubmit');
        const max=this.getMaxVotes();
        if(btn&&!this.userVoted&&!this._submitting){
          btn.disabled=!this.selectedKeys.length||this.selectedKeys.length>max||!this.checkQQ();
        }
        const hint=$('#vbHint');
        if(hint){
          if(qqInp.value && !/^\d{5,13}$/.test(qqInp.value.trim())){
            hint.textContent='QQ号需为5-13位数字';
            hint.className='vb-hint err';
          }else{
            hint.textContent='';
            hint.className='vb-hint';
          }
        }
      });
    }

    const subBtn=$('#vbSubmit');
    if(subBtn&&!subBtn.dataset.bound){
      subBtn.dataset.bound='1';
      subBtn.addEventListener('click',()=>this.submitVote());
    }
  },

  async submitVote(){
    const max=this.getMaxVotes();
    if(this._submitting||!this.config||!this.config.enabled||!this.selectedKeys.length||this.selectedKeys.length>max||!this.checkQQ()||this.userVoted)return;
    const keys=this.selectedKeys.slice(),eventId=this.config.eventId,qq=$('#vbQQ').value.trim();
    const btn=$('#vbSubmit'),hint=$('#vbHint');
    this._submitting=true;this.updateBar();btn.textContent='投票提交中…';
    try{
      const result=await Social.call('/api/vote/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keys,eventId,qq,visitor:Identity.pack()})});
      this.userVoted=true;this.votedKeys=result.votedKeys||keys;this.votedKey=this.votedKeys[0]||null;
      hint.textContent='投票成功，感谢你的参与';hint.className='vb-hint ok';
      clearTimeout(this._closeTimer);this._closeTimer=setTimeout(()=>this.closeBoard(),1800);
    }catch(error){
      hint.textContent='投票未完成：'+error.message;hint.className='vb-hint err';
    }finally{this._submitting=false;this.updateBar()}
  }

};

/* ─── 摄影作品征集投递模块 (Photo Submissions) ─── */
const Submission={
  config:null,
  photos:[],   // [ { file, data, tn, title } ]
  userSubmitted:false,
  submittedItem:null,

  getMaxPhotos(){
    return (this.config&&this.config.maxPhotos)?Math.min(3,Math.max(1,parseInt(this.config.maxPhotos,10)||3)):3;
  },

  async init(){
    this.bindUI();
    await this.fetchStatus();
  },

  async fetchStatus(){
    try{
      const r=await fetchWithTimeout((CONFIG.apiBase||'')+'/api/submission/config?vid='+encodeURIComponent(Identity.id||''),{cache:'no-store'},10000);
      if(!r.ok)throw new Error('活动信息暂时不可用');
      const j=await r.json();
      if(this.config&&this.config.eventId!==j.eventId)this.photos=[];
      this.config=j;
      this.userSubmitted=Boolean(j.userSubmitted);
      this.submittedItem=j.submittedItem||null;
      this.applyVisibility();
      // 投票邀请与投稿配置是并行加载的,后到的投稿配置需要刷新邀请里的入口。
      CONFIG.localSubmissions=j.storage==='local';
    }catch(e){}
  },

  applyVisibility(){
    const topBadge=$('#topSubBadge');
    if(!this.config||!this.config.enabled||this.config.isExpired){
      if(topBadge)topBadge.hidden=true;
      const board=$('#subBoardModal');if(board)board.hidden=true;
      return;
    }
    // 活动开启中: 顶栏展示投稿徽章
    if(topBadge)topBadge.hidden=false;
  },

  openBoard(){
    const b=$('#subBoardModal');
    if(!b)return;
    b.hidden=false;
    document.body.style.overflow='hidden';
    const max=this.getMaxPhotos();
    $('#sbTitle').textContent=this.config.title||'摄影作品征集';
    const tag=$('#sbTag');if(tag)tag.textContent=`最多 ${max} 张`;
    const sub=$('#sbSub');if(sub)sub.textContent=`选择 1~${max} 张原创摄影作品`;
    $('#sbRules').textContent=(this.config.rules||'')+(this.config.reward?'\n\n参与纪念：'+this.config.reward:'')+(this.config.deadline?'\n\n截止时间：'+this.config.deadline+'（北京时间）':'');
    this.renderCards();
    this.updateBar();
  },

  closeBoard(){
    const b=$('#subBoardModal');
    if(b)b.hidden=true;
    if(($('#voteNoticeModal')&&!$('#voteNoticeModal').hidden)||($('#voteBoardModal')&&!$('#voteBoardModal').hidden)){}
    else{document.body.style.overflow='';}
  },

  /* 渲染 1~3 张照片选取卡片 */
  renderCards(){
    const grid=$('#sbPickGrid');
    if(!grid)return;
    const max=this.getMaxPhotos();
    const list=this.userSubmitted&&this.submittedItem?(this.submittedItem.photos||[]):this.photos;

    let html='';
    list.forEach((p,idx)=>{
      const rawSrc=p.tn||p.data||(p.k?cosURL(p.k):'');
      const src=rawSrc&&/^(data:|blob:|https?:\/\/|\/)/i.test(rawSrc)?rawSrc:cosURL(rawSrc);
      const t=p.title||`作品 ${String(idx+1).padStart(2,'0')}`;
      html+=`
        <div class="sb-card has-img">
          <span class="sb-card-num">${String(idx+1).padStart(2,'0')}</span>
          ${!this.userSubmitted?`<button class="sb-card-del" type="button" data-idx="${idx}" title="移除这张照片">✕</button>`:''}
          <img src="${safeUrl(src)}" alt="${esc(t)}" loading="lazy" decoding="async">
        </div>
      `;
    });

    if(!this.userSubmitted&&list.length<max){
      html+=`
        <button class="sb-card sb-add-card" id="sbAddBtn" type="button" aria-label="挑选照片上传">
          <div class="sb-add-ico">＋</div>
          <div class="sb-add-txt">添加照片 (${list.length}/${max})</div>
        </button>
      `;
    }
    grid.innerHTML=html;

    $('#sbAddBtn')?.addEventListener('click',()=>$('#sbFileInput')?.click());
    grid.querySelectorAll('.sb-card-del').forEach(btn=>{
      btn.addEventListener('click',(e)=>{
        const idx=+e.currentTarget.dataset.idx;
        this.removePhoto(idx);
      });
    });
  },

  removePhoto(idx){
    if(this._processing||this._submitting)return;
    if(idx>=0&&idx<this.photos.length){
      this.photos.splice(idx,1);
      this.renderCards();
      this.updateBar();
    }
  },

  /* 选图后处理: 纯前端离屏压缩生成高清(1600)和小图(480) */
  async handleFiles(fileList){
    if(this._processing||this._submitting||this.userSubmitted)return;
    const files=Array.from(fileList||[]),remain=this.getMaxPhotos()-this.photos.length;
    if(!files.length||remain<=0)return;
    this._processing=true;this.updateBar();
    const hint=$('#sbHint');hint.textContent='正在生成浏览预览，请稍候…';hint.className='vb-hint';
    let failed=0,added=0;
    try{
      for(const file of files.slice(0,remain)){
        try{
          if(file.size>30*1024*1024)throw new Error('文件超过 30MB');
          if(!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.type)&&!(/\.(jpe?g|png|webp|gif)$/i.test(file.name)&&!file.type))throw new Error('格式不支持');
          const view=await Thumb.make(file,Thumb.VIEW,.86);
          const small=await Thumb.make(view,Thumb.SMALL,.82);
          const values=await Promise.all([this.blobToDataUrl(view),this.blobToDataUrl(small)]);
          this.photos.push({data:values[0],tn:values[1],title:file.name.replace(/\.[^.]+$/,'').slice(0,40)});added++;
        }catch(error){failed++}
      }
    }finally{
      this._processing=false;this.renderCards();this.updateBar();
      hint.textContent=failed?`已添加 ${added} 张，${failed} 张无法处理。请选择 30MB 内的 JPEG、PNG、WebP 或 GIF。`:`已添加 ${added} 张作品`;
      hint.className=failed?'vb-hint err':'vb-hint';
    }
  },

  blobToDataUrl(blob){
    return new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=()=>res(r.result);
      r.onerror=rej;
      r.readAsDataURL(blob);
    });
  },

  updateBar(){
    const submitBtn=$('#sbSubmit'),qqInput=$('#sbQQ'),hint=$('#sbHint');
    const titleInput=$('#sbWorkTitle');
    const max=this.getMaxPhotos();

    const av=$('#sbMeAv'),nm=$('#sbMeName');
    if(av)av.innerHTML=Avatar.svg(Identity.avatar,28);
    if(nm)nm.textContent=Identity.nick;

    if(this.userSubmitted){
      if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='已投稿';}
      if(qqInput){qqInput.disabled=true;if(this.submittedItem)qqInput.value=this.submittedItem.qq;}
      if(titleInput){titleInput.disabled=true;if(this.submittedItem)titleInput.value=this.submittedItem.title;}
      if(hint)hint.textContent='✓ 你已完成投稿，截稿后站长将公布精选结果！';
      return;
    }

    if(qqInput)qqInput.disabled=!!this._submitting;
    if(titleInput)titleInput.disabled=!!this._submitting;
    const fileInput=$('#sbFileInput');if(fileInput)fileInput.disabled=!!this._submitting||!!this._processing;
    const count=this.photos.length;
    if(submitBtn){
      submitBtn.textContent=`确认投递作品 (${count}/${max} 张)`;
      submitBtn.disabled=!!this._processing||!!this._submitting||count===0||count>max||!this.checkQQ();
    }
  },

  checkQQ(){
    const qq=($('#sbQQ')?$('#sbQQ').value:'').trim();
    return /^\d{5,13}$/.test(qq);
  },

  bindUI(){
    $('#topSubBadge')?.addEventListener('click',()=>this.openBoard());
    $('#sbClose')?.addEventListener('click',()=>this.closeBoard());
    $('#sbMask')?.addEventListener('click',()=>this.closeBoard());

    const fileInp=$('#sbFileInput');
    if(fileInp&&!fileInp.dataset.bound){
      fileInp.dataset.bound='1';
      fileInp.addEventListener('change',(e)=>{
        this.handleFiles(e.target.files);
        e.target.value='';
      });
    }

    const qqInp=$('#sbQQ');
    if(qqInp&&!qqInp.dataset.bound){
      qqInp.dataset.bound='1';
      qqInp.addEventListener('input',()=>{
        this.updateBar();
        const hint=$('#sbHint');
        if(hint){
          if(qqInp.value && !/^\d{5,13}$/.test(qqInp.value.trim())){
            hint.textContent='QQ号需为5-13位数字';
            hint.className='vb-hint err';
          }else{
            hint.textContent='';
            hint.className='vb-hint';
          }
        }
      });
    }

    $('#sbSubmit')?.addEventListener('click',()=>this.submit());
  },

  async submit(){
    if(this._processing||this._submitting||!this.config||!this.config.enabled||!this.photos.length||this.photos.length>this.getMaxPhotos()||!this.checkQQ()||this.userSubmitted)return;
    this._submitting=true;
    const qq=$('#sbQQ').value.trim();
    const title=($('#sbWorkTitle')?$('#sbWorkTitle').value:'').trim();
    const btn=$('#sbSubmit'),hint=$('#sbHint');

    btn.disabled=true;btn.textContent='正在上传作品…';
    if(hint){hint.textContent='作品投递中，请勿关闭页面…';hint.className='vb-hint';}

    try{
      const payload={
        visitor:Identity.pack(),
        eventId:this.config.eventId,
        qq,
        title,
        photos:this.photos.map(p=>({
          data:p.data,
          tn:p.tn,
          title:p.title
        }))
      };

      const r=await fetchWithTimeout((CONFIG.apiBase||'')+'/api/submission/submit',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      },30000);
      const j=await r.json();
      if(!r.ok||!j.ok)throw new Error(j.error||'投递失败');

      this.userSubmitted=true;
      this.submittedItem=j.item;
      if(hint){hint.textContent='✓ 作品投递成功！感谢你的参与';hint.className='vb-hint ok';}
      this.renderCards();
      this.updateBar();
      setTimeout(()=>this.closeBoard(),2400);
    }catch(e){
      btn.disabled=false;
      this.updateBar();
      if(hint){hint.textContent=e.message;hint.className='vb-hint err';}
    }finally{this._submitting=false;this.updateBar()}
  }
};

/* ─── 归档:年→月→日三级折叠;日展开显示该组印样 ─── */
const Archive=createArchive({$,Store,YEARS,totalPhotos,esc,pURL,pView,Motion,storageGet,storageSet,
  openGroup:day=>Motion.transition(()=>GroupPage.open(day)),openProof:(day,idx)=>{const g=groupOf(day);if(g)Lightbox.open(g,idx)},closeGroup:()=>Motion.transition(()=>GroupPage.close(),{back:true}),openAdmin:()=>Admin.open()});

/* ─── 组详情子页面 ─── */
const GroupPage={
  el:null,previews:null,g:null,
  init(){
    this.el=$('#groupPage');
    this.previews=$('#gpPreviews');
    this.blank=$('#gpBlank');
    $('#gpBack').addEventListener('click',()=>Motion.transition(()=>this.close(),{back:true}));
    /* 预览图点击 → 打开悬浮窗 */
    this.previews.addEventListener('click',e=>{
      const item=e.target.closest('.gp-preview-item');
      if(item)Lightbox.open(this.g,+item.dataset.idx);
    });
  },
  open(day){
    this.g=groupOf(day);
    if(!this.g)return;
    if(this.el.hidden){this.returnScroll=window.scrollY;this.returnFocus=document.activeElement}
    this.paint();
    $('#archive').hidden=true;
    this.el.hidden=false;
    document.querySelector('.topbar').classList.add('is-inner');
    window.scrollTo({top:0,behavior:'auto'});
    document.title=`${this.g.title} · Phototropic`;
    /* 组留言:进入这一组时加载并显示它的留言(空组也有) */
    Social.bindGroup(this.g);
  },
  close(){
    if(this.el.hidden)return;
    this.el.hidden=true;$('#archive').hidden=false;
    document.querySelector('.topbar').classList.remove('is-inner');
    document.title='Phototropic · 光影档案';
    window.scrollTo(0,this.returnScroll||0);
    if(this.returnFocus&&this.returnFocus.isConnected)this.returnFocus.focus({preventScroll:true});
  },
  paint(){
    const g=this.g;
    $('#gpDate').textContent=`${g.d.slice(0,4)} 年 ${g.d.slice(5,7)} 月 ${g.d.slice(8)} 日 · 周${dayCn(g.d)}`;
    $('#gpTitle').textContent=g.title;
    $('#gpLoc').textContent=g.loc;
    /* 整组介绍:归在这一组名下的文字,没有就不占位置 */
    const note=$('#gpNote');
    if(note){
      const c=(g.c||'').trim();
      note.textContent=c;
      note.hidden=!c;
    }
    /* 没有照片的组:隐藏空白网格,改显示说明,让"空组"看起来是刻意的状态而不是坏页 */
    const empty=!g.gs||!g.gs.length;
    if(this.blank)this.blank.hidden=!empty;
    this.previews.hidden=empty;
    if(empty){this.previews.innerHTML='';return}
    /* 预览图网格:每张图片正下方带各自的相机参数(机身型号 + 参数),单张无则回退整组默认 */
    this.previews.innerHTML=g.gs.map((p,i)=>`
      <figure class="gp-preview-item" data-idx="${i}" style="--i:${i}" tabindex="0" role="button" aria-label="查看 ${esc(p.t)}">
        <div class="gp-thumb"><img src="${safeUrl(pURL(p,500))}" alt="${esc(p.t)}" loading="lazy" decoding="async"></div>
        <div class="gp-card-foot">
          <div class="gp-card-title-row"><span class="gp-num-inline">${String(i+1).padStart(2,'0')}</span><span class="gp-card-title">${esc(p.t)}</span><span class="gp-card-arrow" aria-hidden="true">↗</span></div>
          ${ExifCard.compact(p.exif||g.exif||'')||'<span class="gp-noex">相机参数未识别</span>'}
        </div>
      </figure>`).join('');
    Motion.observe(this.previews);
    /* 图片懒加载动画 */
    this.previews.querySelectorAll('img').forEach(img=>{
      const fit=()=>{
        img.classList.add('loaded');
        const box=img.closest('.gp-thumb');
        if(box&&img.naturalWidth&&img.naturalHeight){
          const ratio=Math.max(.72,Math.min(1.65,img.naturalWidth/img.naturalHeight));
          box.style.aspectRatio=ratio.toFixed(3);
        }
      };
      img.addEventListener('load',fit,{once:true});
      if(img.complete&&img.naturalWidth)fit();
    });
    /* 绑定预览图点击 */
    this.previews.querySelectorAll('.gp-preview-item').forEach((item,i)=>{
      item.addEventListener('keydown',e=>{   /* 键盘无障碍:Enter/Space 打开悬浮窗 */
        if(e.key==='Enter'||e.key===' '){e.preventDefault();Lightbox.open(this.g,i)}
      });
    });
  }
};

/* ─── EXIF 参数矩阵:把 "机身 · 镜头<br>56mm · f/1.4 · 1/500s · ISO 320" 结构化为光学仪表盘 ─── */
/* 解析失败或字段缺失时自动退化为原文显示,任何输入都不丢信息 */
const ExifCard={
  render(html){
    if(!html)return '';
    const lines=String(html).split(/<br\s*\/?>/i).map(l=>l.replace(/<[^>]*>/g,'').trim()).filter(Boolean);
    if(!lines.length)return '';
    const head=esc(lines[0]);
    /* 第二行按 " · " 拆段,逐段精确匹配四要素 */
    const segs=lines.length>1?lines.slice(1).join(' · ').split('·').map(s=>s.trim()).filter(Boolean):[];
    const used=[],cells=[];
    const take=(label,re)=>{
      for(let i=0;i<segs.length;i++){
        if(used[i])continue;
        const m=segs[i].match(re);
        if(m){used[i]=1;cells.push({l:label,v:esc(m[1])});return}
      }
    };
    take('焦距',/^(\d+(?:\.\d+)?mm)$/);
    take('光圈',/^(f\/\d+(?:\.\d+)?)$/i);
    take('快门',/^((?:1\/)?\d+(?:\.\d+)?s)$/);
    take('感光度',/^(ISO\s*\d+)$/i);
    if(!cells.length)return `<div class="exm-head">${head}</div><div class="exm-note">${esc(lines.slice(1).join(' · '))}</div>`;   /* 无法结构化 → 仅头行 */
    const note=segs.filter((s,i)=>!used[i]).join(' · ');
    return `<div class="exm-head">${head}</div>`+
      `<div class="exm-grid">${cells.map(c=>`<div class="exm-cell"><span class="exm-l">${c.l}</span><span class="exm-v">${c.v}</span></div>`).join('')}</div>`+
      (note?`<div class="exm-note">${esc(note)}</div>`:'');
  },
  /* 紧凑版:首行=机身·镜头(相机型号),其余=参数。用于组详情页每张图下方的独立小卡片 */
  compact(html){
    if(!html)return '';
    const lines=String(html).split(/<br\s*\/?>/i).map(l=>l.replace(/<[^>]*>/g,'').trim()).filter(Boolean);
    if(!lines.length)return '';
    const head=lines.length>1?esc(lines[0]):'';          /* 有多行:首行为机身·镜头 */
    const body=esc(lines[lines.length>1?1:0]);            /* 参数行 */
    return `<div class="gp-exif-cap" title="${head||body}">`+
      (head?`<span class="gp-ph">${head}</span>`:'')+
      `<span class="gp-pb">${body}</span></div>`;
  }
};

/* ─── 单图悬浮窗 ─── */
/* ─── 移动端"长按保存"浮层(微信/QQ 等应用内浏览器无法触发下载,长按是唯一可靠方式) ─── */
const SaveHint={
  show(url,fallbackUrl,canDownload,fname){
    this.close();
    const ov=document.createElement('div');
    ov.id='saveHint';
    ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-label','保存原图');
    ov.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;z-index:9000;background:rgba(8,6,14,.98);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px';
    const title=document.createElement('div');
    title.textContent='保 存 原 图';
    title.style.cssText='font-size:14px;font-weight:600;color:#fff;letter-spacing:.22em;margin-bottom:14px';
    const box=document.createElement('div');
    box.style.cssText='max-width:92vw;max-height:60vh;display:flex;align-items:center;justify-content:center';
    const spin=document.createElement('div');
    spin.textContent='原图加载中 …';
    spin.style.cssText='font-family:var(--mono);font-size:11px;color:rgba(253,252,250,.55);letter-spacing:.1em;padding:70px 36px;border:1px dashed rgba(255,255,255,.22);border-radius:12px';
    const img=document.createElement('img');
    img.alt='长按这张图片即可保存';
    img.referrerPolicy='no-referrer';
    img.style.cssText='display:none;max-width:92vw;max-height:60vh;object-fit:contain;border-radius:12px;border:1px solid rgba(255,255,255,.12)';
    img.onload=()=>{spin.style.display='none';img.style.display='block';tip.textContent='请长按上方图片 → 菜单中选「保存图片」';tip.style.animation='none'};
    img.onerror=()=>{
      if(fallbackUrl&&fallbackUrl!==url){const fallback=fallbackUrl;fallbackUrl=null;img.src=fallback}
      else{spin.textContent='原图加载失败,请点下方按钮打开'}
    };
    img.src=url;
    box.appendChild(spin);box.appendChild(img);
    const tip=document.createElement('p');
    tip.textContent='正在加载原图,请稍候 …';
    tip.style.cssText='margin-top:16px;font-size:13px;color:rgba(253,252,250,.9);text-align:center;line-height:1.9;letter-spacing:.05em;animation:savePulse 1.5s ease-in-out infinite';
    const row=document.createElement('div');
    row.style.cssText='display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:16px;max-width:92vw';
    const mkBtn=(txt,primary)=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.style.cssText='padding:10px 20px;border-radius:999px;font-size:12px;letter-spacing:.1em;'+
        (primary
          ?'background:linear-gradient(135deg,var(--coral),var(--apricot));color:#fff;border:1px solid transparent'
          :'background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.22)');
      return b;
    };
    /* 新窗口打开原图:微信/QQ 会用自带图片查看器打开(里面同样可长按保存) */
    const openBtn=mkBtn('新窗口打开原图');
    openBtn.onclick=()=>{location.href=url};
    row.appendChild(openBtn);
    /* 非微信/QQ 手机浏览器:额外提供真正的文件下载 */
    if(canDownload){
      const dlBtn=mkBtn('直接下载',true);
      dlBtn.onclick=async()=>{
        try{
          const res=await fetchWithTimeout(url,{mode:'cors'},30000);
          if(!res.ok)throw new Error(res.status);
          const blob=await res.blob();
          const objUrl=URL.createObjectURL(blob);
          const a=document.createElement('a');
          a.href=objUrl;a.download=fname||'photo.jpg';
          document.body.appendChild(a);a.click();a.remove();
          setTimeout(()=>URL.revokeObjectURL(objUrl),4000);
        }catch(e){}
      };
      row.appendChild(dlBtn);
    }
    const closeBtn=mkBtn('关 闭');
    closeBtn.onclick=()=>this.close();
    row.appendChild(closeBtn);
    ov.appendChild(title);ov.appendChild(box);ov.appendChild(tip);ov.appendChild(row);
    document.body.appendChild(ov);
    Dialogs.register(ov,()=>this.close());
  },
  close(){const el=document.getElementById('saveHint');if(el&&el.parentNode){Dialogs.unregister(el);el.parentNode.removeChild(el)}}
};

const Lightbox={
  el:null,img:null,g:null,cur:0,
  init(){
    this.el=$('#lightbox');
    const UA=navigator.userAgent||'';
    this.mobile=/Android|iPhone|iPad|HarmonyOS|Mobile/i.test(UA)||(navigator.maxTouchPoints>1&&/Macintosh/i.test(UA));
    /* 手机端按钮语义改为"保存"(微信/QQ 内无法直接下载) */
    if(this.mobile){
      const l=document.querySelector('#lbDownload .lb-btn-label');
      if(l)l.textContent='保存原图';
    }
    this.img=$('#lbImg');
    $('#lbClose').addEventListener('click',()=>this.close());
    $('#lbPrev').addEventListener('click',()=>this.step(-1));
    $('#lbNext').addEventListener('click',()=>this.step(1));
    this.el.addEventListener('click',e=>{
      if(e.target===this.el||e.target.classList.contains('lb-stage'))this.close();
    });
    addEventListener('keydown',e=>{
      if(!this.el.classList.contains('open'))return;
      if(e.key==='Escape')this.close();
      if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable)return;
      if(e.key==='ArrowLeft')this.step(-1);
      if(e.key==='ArrowRight')this.step(1);
    });
    $('#lbDownload').addEventListener('click',async()=>{
      const p=this.g.gs[this.cur];
      const url=pFull(p);
      const btn=$('#lbDownload');
      if(btn.classList.contains('busy'))return;
      const UA=navigator.userAgent||'';
      const mobile=this.mobile;
      const inApp=/MicroMessenger|MQQBrowser|QQ\/|QZONE|Weibo|DingTalk|AlipayClient|baiduboxapp|snssdk|aweme|tieba/i.test(UA);
      /* 文件名:组名_照片名_日期.jpg */
      const extension=p.k&&/\.([a-z0-9]{1,8})$/i.exec(p.k);
      const fname=`${this.g.title}_${p.t}_${this.g.d.replace(/-/g,'')}.${extension?extension[1]:'jpg'}`;
      /* 手机统一走"长按保存"浮层:微信/QQ 内置浏览器无法触发文件下载,长按在所有手机浏览器都可用 */
      if(mobile){
        SaveHint.show(url,(this.img&&this.img.src)?this.img.src:null,!inApp,fname);
        return;
      }
      /* 桌面:blob 下载 */
      btn.classList.add('busy');
      const label=btn.querySelector('.lb-btn-label');
      const orig=label?label.textContent:'';
      if(label)label.textContent='下载中…';
      try{
        const res=await fetchWithTimeout(url,{mode:'cors'},30000);
        if(!res.ok)throw new Error(res.status);
        const blob=await res.blob();
        const objUrl=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=objUrl;a.download=fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(()=>URL.revokeObjectURL(objUrl),4000);
      }catch(err){
        /* 跨域或网络失败 → 新标签页打开手动保存 */
        open(url,'_blank','noopener');
      }finally{
        btn.classList.remove('busy');
        if(label)label.textContent=orig||'下载原图';
      }
    });
    this.initZoom();
  },
  /* ─── 手势:双指缩放 · 双击放大 · 放大后单指平移 · 未放大横滑翻页 ─── */
  /* 纯 transform 实现,不触碰 src,不拦截长按(长按保存原图链路不受影响) */
  initZoom(){
    const st=this.el.querySelector('.lb-stage');
    if(!st||this._zoomBound)return;
    this._zoomBound=true;
    const img=this.img;
    let s=1,x=0,y=0,mode=0,sx=0,sy=0,ox=0,oy=0,pd=0,ps=1,t0x=0,t0y=0,moved=false,lastT=0,lastX=0,lastY=0;
    const clamp=()=>{
      if(s<=1){s=1;x=0;y=0;return}
      const mx=Math.max(0,img.offsetWidth*(s-1)/2),my=Math.max(0,img.offsetHeight*(s-1)/2);
      x=Math.max(-mx,Math.min(mx,x));y=Math.max(-my,Math.min(my,y));
    };
    const apply=anim=>{
      img.style.transition=anim?'transform .35s cubic-bezier(.22,1,.36,1)':'';
      img.style.transform=s>1?'translate('+x+'px,'+y+'px) scale('+s+')':'';
    };
    this._zoomReset=()=>{s=1;x=0;y=0;apply(true)};
    const zoomAt=(k,cx,cy)=>{          /* 以视口点为锚缩放 */
      const r=img.getBoundingClientRect();
      x+=(cx-(r.left+r.width/2))*(1-k);
      y+=(cy-(r.top+r.height/2))*(1-k);
      s=Math.max(1,Math.min(4,s*k));
      clamp();apply(true);
    };
    st.addEventListener('touchstart',e=>{
      if(e.touches.length===1){
        mode=1;moved=false;
        sx=e.touches[0].clientX;sy=e.touches[0].clientY;ox=x;oy=y;t0x=sx;t0y=sy;
      }else if(e.touches.length===2){
        mode=2;moved=true;
        pd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
        ps=s;
      }
    },{passive:true});
    st.addEventListener('touchmove',e=>{
      if(!mode)return;
      e.preventDefault();               /* 覆盖层内接管滚动/页面双击缩放 */
      if(mode===1){
        const dx=e.touches[0].clientX-sx,dy=e.touches[0].clientY-sy;
        if(Math.abs(dx)>6||Math.abs(dy)>6)moved=true;
        if(s>1){x=ox+dx;y=oy+dy;clamp();apply(false)}
      }else if(mode===2&&e.touches.length===2){
        const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
        if(pd>0){s=Math.max(1,Math.min(4,ps*d/pd));clamp();apply(false)}
      }
    },{passive:false});
    st.addEventListener('touchend',e=>{
      if(mode===1&&!moved&&e.changedTouches.length){
        const cx=e.changedTouches[0].clientX,cy=e.changedTouches[0].clientY,now=Date.now();
        if(now-lastT<300&&Math.abs(cx-lastX)<50&&Math.abs(cy-lastY)<50){   /* 双击:放大/复位 */
          if(s>1)this._zoomReset();else zoomAt(2.5,cx,cy);
          lastT=0;
        }else{lastT=now;lastX=cx;lastY=cy}
      }else if(mode===1&&moved&&s===1&&e.changedTouches.length){
        const dx=e.changedTouches[0].clientX-t0x,dy=e.changedTouches[0].clientY-t0y;
        if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5){               /* 横滑翻页 */
          this.step(dx<0?1:-1);
        }
      }
      if(!e.touches.length)mode=0;
    });
    /* 桌面:滚轮缩放 + 双击放大(触屏设备交给 touch,避免双触发) */
    if(!('ontouchstart' in window)){
      st.addEventListener('wheel',e=>{
        e.preventDefault();
        zoomAt(e.deltaY<0?1.18:0.85,e.clientX,e.clientY);
      },{passive:false});
      img.addEventListener('dblclick',e=>{
        if(s>1)this._zoomReset();else zoomAt(2.5,e.clientX,e.clientY);
      });
    }
  },
  open(g,idx){
    this.g=g;
    this.cur=idx||0;
    this.paint();
    this.el.hidden=false;
    this.el.classList.add('open');
    document.body.style.overflow='hidden';
    Motion.present(this.el);
  },
  close(){
    if(this.el.hidden)return;
    Motion.dismiss(this.el,()=>this.finishClose());
  },
  finishClose(){
    this.el.classList.remove('open');
    this.el.hidden=true;
    if(this._pre){this._pre.onload=null;this._pre.onerror=null;this._pre=null}
    this.img.onload=null;
    document.body.style.overflow='';
    if(this._zoomReset)this._zoomReset();
  },
  step(d){this.cur=(this.cur+d+this.g.gs.length)%this.g.gs.length;this.paint()},
  /* 原图就绪角标:告知用户当前长按/另存拿到的是预览还是原图 */
  _q(txt,cls){
    const el=$('#lbQuality');
    if(!el)return;
    el.textContent=txt;
    el.className='lb-quality '+(cls||'');
  },
  paint(){
    const g=this.g,p=g.gs[this.cur];
    this.img.onload=null;
    if(this._zoomReset)this._zoomReset();     /* 换图先复位缩放 */
    this.img.alt=p.t;
    $('#lbTitle').textContent=p.t;
    $('#lbGroup').textContent=g.title;
    $('#lbIdx').textContent=`${this.cur+1} / ${g.gs.length}`;
    /* 相机参数:每张各自一份,结构化为光学仪表盘;该张未识别到时回退整组默认(兼容旧数据/演示数据) */
    const exifHTML=p.exif||g.exif||'';
    $('#lbExif').innerHTML=exifHTML?ExifCard.render(exifHTML):'—';
    /* 介绍:优先显示这张照片房主写的介绍,未写则回退整组介绍 */
    $('#lbCaption').textContent=(p.d&&p.d.trim())?p.d.trim():(g.c||'');
    /* 互动区:切到这张照片的点赞与评论(数据来自 COS) */
    Social.bind(g,p);
    if(this._pre){this._pre.onload=null;this._pre.onerror=null;this._pre=null}
    const generation=(this._imageGeneration||0)+1;this._imageGeneration=generation;
    const stale=()=>this._imageGeneration!==generation||this.g!==g||this.g.gs[this.cur]!==p||this.el.hidden;
    const view=pView(p),small=pURL(p,Thumb.SMALL),hasPreview=!!(p.tn&&(p.tn.s||p.tn.v));
    let smallFailed=false,viewFailed=false;
    this.img.onerror=()=>{
      if(stale())return;
      if(this.img.getAttribute('src')===small&&small!==view&&!viewFailed){smallFailed=true;this.img.src=view;return}
      this._q('预览暂时不可用，请稍后重试或选择下载原图','error');
    };
    this.img.onload=()=>{
      if(stale())return;
      this.img.parentElement.classList.remove('image-error');
      this._q(hasPreview?'高清预览 · 原图请点下载':'这张作品暂未生成预览，正在显示原图','ready');
    };
    this.img.src=small;this._q('作品载入中…','load');
    if(view!==small){
      const pre=new Image();this._pre=pre;
      pre.onload=()=>{if(!stale())this.img.src=view};
      pre.onerror=()=>{viewFailed=true;if(!stale())this._q(smallFailed?'预览暂不可用，请下载原图或稍后重试':'高清预览暂不可用，正在显示缩略图','load')};
      pre.src=view;
    }

  }
};

/* ─── EXIF 自动识别:纯前端解析 JPEG,无外部依赖 ─── */
const Exif={
  /* 读取文件 EXIF 原始标签(仅 JPEG;PNG/WebP/HEIC 返回 null) */
  async read(file){
    try{
      if(!file)return null;
      const isJpg=/image\/jpe?g/i.test(file.type)||/\.jpe?g$/i.test(file.name);
      if(!isJpg)return null;
      const buf=await new Promise((res,rej)=>{   /* FileReader 全兼容(Blob.arrayBuffer 需 Chrome 76+) */
        const r=new FileReader();
        r.onload=()=>res(r.result);
        r.onerror=()=>rej(r.error||new Error('read fail'));
        r.readAsArrayBuffer(file.slice(0,262144));   /* 前 256KB 足够容纳 EXIF */
      });
      const v=new DataView(buf);
      if(v.byteLength<4||v.getUint16(0)!==0xFFD8)return null; /* JPEG SOI */
      let off=2;
      while(off+4<v.byteLength){
        if(v.getUint8(off)!==0xFF)break;
        const marker=v.getUint16(off);
        if(marker>=0xFFD8&&marker<=0xFFD9||marker>=0xFF01&&marker<=0xFF0F)break; /* 无长度段 */
        if(marker===0xFFDA)break;                        /* 图像数据开始,EXIF 只会更靠前 */
        const size=v.getUint16(off+2);
        if(marker===0xFFE1&&v.getUint32(off+4)===0x45786966){ /* APP1 "Exif\0\0" */
          return this.tiff(v,off+10);
        }
        off+=2+size;
      }
      return null;
    }catch(e){return null}
  },
  /* TIFF 头解析:返回标签字典 */
  tiff(v,start){
    if(start+8>v.byteLength)return null;
    const bom=v.getUint16(start);
    const le=bom===0x4949;
    if(!le&&bom!==0x4D4D)return null;
    const u16=p=>v.getUint16(p,le),u32=p=>v.getUint32(p,le);
    const ifdOff=u32(start+4);
    if(ifdOff<8||start+ifdOff+2>v.byteLength)return null;
    const tags={},visited=new Set();
    const walk=(ptr)=>{
      if(visited.has(ptr)||visited.size>=16)return;
      visited.add(ptr);
      if(ptr<8||start+ptr+2>v.byteLength)return;
      const n=u16(start+ptr);
      let p=start+ptr+2;
      for(let i=0;i<n&&p+12<=v.byteLength;i++,p+=12){
        const tag=u16(p),type=u16(p+2),cnt=u32(p+4);
        const sz=(type===3?2:type===4||type===9?4:type===5||type===10?8:type===2||type===1||type===7?1:0)*cnt;
        if(!sz)continue;
        const valP=sz<=4?p+8:start+u32(p+8);
        if(valP+sz>v.byteLength)continue;
        if(tag===0x8769){walk(u32(p+8));continue}          /* Exif 子 IFD */
        if(tag===0x010F)tags.make=this.str(v,valP,cnt);
        else if(tag===0x0110)tags.model=this.str(v,valP,cnt);
        else if(tag===0xA434)tags.lens=this.str(v,valP,cnt);
        else if(tag===0x829D)tags.fnum=this.rat(v,valP,le);
        else if(tag===0x829A)tags.exp=this.rat(v,valP,le);
        else if(tag===0x920A)tags.focal=this.rat(v,valP,le);
        else if(tag===0xA405)tags.focal35=u16(valP);
        else if(tag===0x8827)tags.iso=u16(valP);
      }
    };
    walk(ifdOff);
    return (tags.make||tags.model||tags.lens||tags.fnum||tags.exp||tags.focal||tags.iso)?tags:null;
  },
  str(v,p,cnt){let s='';for(let i=0;i<cnt-1;i++){const b=v.getUint8(p+i);if(!b)break;s+=String.fromCharCode(b)}return s.trim()},
  rat(v,p,le){const a=v.getUint32(p,le),b=v.getUint32(p+4,le);return b?a/b:0},
  /* 标签 → 展示字符串(与演示数据同格式) */
  fmt(t){
    if(!t)return '';
    const mk=(t.make||'').replace(/\s+/g,' ').trim(),md=(t.model||'').replace(/\s+/g,' ').trim();
    let cam=md||mk;                                            /* 默认用 Model */
    if(mk&&md&&!md.toUpperCase().startsWith(mk.toUpperCase())&&mk.toLowerCase()!=='apple')cam=mk+' '+md;  /* "FUJIFILM"+"X-T5"→"FUJIFILM X-T5";大小写透明;Apple 例外 */
    let lens=t.lens||'';
    if(lens&&(lens.startsWith(cam)||cam.startsWith(lens)))lens='';   /* iPhone 等机身镜头同名 */
    const head=[cam,lens].filter(Boolean).join(' · ');
    const parts=[];
    /* 实际焦距(≥10mm 时展示;手机等超短焦改用 35mm 等效值更直观) */
    let fl=0;
    if(t.focal>=10)fl=Math.round(t.focal);
    else if(t.focal35||t.focal)fl=Math.round(t.focal35||t.focal);
    if(fl)parts.push(fl+'mm');
    if(t.fnum){const f=Math.round(t.fnum*10)/10;parts.push('f/'+(f%1?f.toFixed(1):f))}
    if(t.exp){
      if(t.exp>=1)parts.push((Math.round(t.exp*10)/10)+'s');
      else{const d=Math.round(1/t.exp);if(d>0)parts.push('1/'+d+'s')}
    }
    if(t.iso)parts.push('ISO '+t.iso);
    const body=parts.join(' · ');
    return head?(body?head+'<br>'+body:head):body;
  }
};

/* ─── 背景音乐:黑胶唱片 · 访客默认静音,点击播放(尊重 autoplay 政策与访客意愿) ─── */
const Player={
  el:null,audio:null,tracks:[],i:0,_tipT:null,
  cosURL(k){return cosURL(k)},
  async init(){
    this.el=$('#disc');
    if(!this.el||!CONFIG.cosBucket){if(this.el)this.el.hidden=true;return}
    this.tracks=[];
    try{
      const r=await fetchWithTimeout(this.cosURL('music.json'),{cache:'no-store'},8000);
      if(r.ok){const j=await r.json();if(j&&Array.isArray(j.tracks))this.tracks=j.tracks.filter(t=>t&&t.k)}
    }catch(e){}
    if(!this.tracks.length){this.el.hidden=true;return}   /* 无曲目:唱片不出现 */
    this.el.hidden=false;
    if(this.audio){this.audio.pause();this.audio.src=''}  /* 重复 init(上传后刷新)先停旧实例 */
    this.audio=new Audio();
    this.audio.preload='none';                            /* 不播不下载,省访客流量 */
    this.audio.addEventListener('ended',()=>{this.i=(this.i+1)%this.tracks.length;this.load(true);this.tip('♪ '+this.cur())});
    this.audio.addEventListener('error',()=>{if(this.audio.src){this.el.classList.remove('playing');this.tip('播放失败,请稍后再试')}});
    if(!this._bound){this._bound=true;this.el.addEventListener('click',()=>this.toggle());this.el.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();this.toggle()}})}
    this.tip(this.tracks.length+' 首 · 点击播放');
  },
  load(autoplay){
    const t=this.tracks[this.i];
    if(!t)return;
    this.audio.src=this.cosURL(t.k);
    if(autoplay)this.audio.play().catch(()=>{});
  },
  toggle(){
    if(!this.audio)return;
    if(this.audio.paused){
      if(!this.audio.src)this.load(false);
      this.audio.play().then(()=>{
        this.el.classList.add('playing');
        this.tip('♪ '+this.cur());
      }).catch(()=>{this.tip('浏览器拦截了播放,请再点一次')});
    }else{
      this.audio.pause();
      this.el.classList.remove('playing');
      this.tip('已暂停');
    }
  },
  cur(){const t=this.tracks[this.i];return t?esc(t.t||'背景乐'):''},
  tip(msg){
    const b=$('#discTip');
    if(!b)return;
    b.innerHTML=msg;
    b.classList.add('show');
    clearTimeout(this._tipT);
    this._tipT=setTimeout(()=>b.classList.remove('show'),2600);
  }
};

/* ─── 管理面板:COS 密钥保存 + 照片直传 ─── */
const Admin={
  el:null,cos:null,_exifs:null,
  init(){
    this.el=$('#adminPanel');
    $('#adminClose').addEventListener('click',()=>this.close());
    $('#adminMask').addEventListener('click',()=>this.close());
    /* 顶栏"管理"按钮已移除(站主要求):入口仅剩 网址#admin 与 logo 连点 5 次 */
    addEventListener('hashchange',()=>{if(location.hash!=='#admin'&&!this.el.hidden)this.close()});
    /* 密钥:本机 localStorage + 浏览器密码管理器双轨(像登录网站的"记住密码") */
    $('#adminSid').value=this.getSid()||'';
    $('#adminSkey').value=this.getSkey()||'';
    $('#adminKeyForm').addEventListener('submit',ev=>{ev.preventDefault();this.saveKeys()});
    $('#adminFillCreds').addEventListener('click',()=>this.fillKeys());
    /* 日期默认今天(本地时区) */
    const t=new Date();
    $('#afDate').value=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    /* 上传提交 */
    $('#adminForm').addEventListener('submit',ev=>{ev.preventDefault();this.upload()});
    /* 只建空分组:表单里不选照片也能建组 */
    const abBtn=$('#adminBlank');
    if(abBtn&&!abBtn.dataset.bound){abBtn.dataset.bound='1';abBtn.addEventListener('click',()=>this.blankGroup())}
    /* 标签页切换:同一时刻只显示一个功能页,避免长条滚动找功能 */
    const tabs=$('#adminTabs');
    if(tabs&&!tabs.dataset.bound){
      tabs.dataset.bound='1';
      tabs.addEventListener('click',ev=>{
        const b=ev.target.closest('.atab');
        if(b)this.tab(b.dataset.tab);
      });
    }
    /* 站点发布:上传首页 + 开启 COS 静态网站 */
    $('#adminPublish').addEventListener('click',()=>this.publishSite());
    /* 背景音乐上传 */
    $('#musicUpload').addEventListener('click',()=>this.uploadMusic());
    /* 选照片后自动识别 EXIF 相机参数 */
    $('#afFiles').addEventListener('change',()=>this.autofillExif());
    /* 已上传照片管理:载入 + 列表事件委托(删/换/介绍失焦保存/缩略图新标签打开) */
    $('#manageLoad').addEventListener('click',()=>this.loadManage());
    const tnBtn=$('#tnFixBtn');
    if(tnBtn&&!tnBtn.dataset.bound){tnBtn.dataset.bound='1';tnBtn.addEventListener('click',()=>this.tnRebuild())}
    const orBtn=$('#orphanBtn');
    if(orBtn&&!orBtn.dataset.bound){orBtn.dataset.bound='1';orBtn.addEventListener('click',()=>this.orphanRebuild())}
    const mg=$('#mgList');
    mg.addEventListener('click',ev=>{
      const b=ev.target.closest('.mg-btn,.mg-thumb');
      if(!b)return;
      if(b.dataset.act==='open'){window.open(this.cosURL(b.dataset.k),'_blank','noopener');return}
      const act=b.dataset.act;
      if(act==='del'){
        const ph=b.closest('.mg-ph');
        this.mgDelete(ph.dataset.d,+ph.dataset.i);
      }else if(act==='gdel'){
        const gsec=b.closest('.mg-group');
        this.mgDeleteGroup(gsec.dataset.d);
      }
    });
    mg.addEventListener('change',ev=>{
      if(ev.target.classList.contains('mg-tone')){
        const row=ev.target.closest('.mg-ph');
        this.mgToneSave(row.dataset.d,+row.dataset.i,ev.target.value);return;
      }
      if(!ev.target.classList.contains('mg-file'))return;
      const ph=ev.target.closest('.mg-ph');
      const f=ev.target.files&&ev.target.files[0];
      ev.target.value='';   /* 允许连续选同一文件再次触发 */
      if(f&&ph)this.mgReplace(ph.dataset.d,+ph.dataset.i,f);
    });
    mg.addEventListener('focusout',ev=>{
      const ta=ev.target;
      if(!ta.classList||!ta.classList.contains('mg-desc'))return;
      /* 点进同组的按钮(删/换)时先让失焦保存跑完,避免保存覆盖后续操作后的数据 */
      setTimeout(()=>{
        const gs=ta.closest&&ta.closest('.mg-group');
        if(!gs||!document.contains(ta))return;   /* 行已被删除/重渲染,丢弃 */
        /* 整组介绍(空分组里那条)与单张介绍走不同的保存路径 */
        if(ta.classList.contains('mg-gdesc')){this.mgGroupDescSave(gs.dataset.d,ta.value);return}
        const ph=ta.closest('.mg-ph');
        if(!ph)return;
        this.mgDescSave(ph.dataset.d,+ph.dataset.i,ta.value);
      },0);
    });
    /* 投票活动管理:保存设置、刷新数据与复制名单 */
    $('#adminVoteForm')?.addEventListener('submit',ev=>{ev.preventDefault();this.saveVoteConfig()});
    $('#avRefreshBtn')?.addEventListener('click',()=>this.loadVoteAdmin());
    $('#avExportBtn')?.addEventListener('click',()=>this.exportVoteList());
    /* 作品征集活动管理:保存设置、刷新作品与复制名单 */
    $('#adminSubForm')?.addEventListener('submit',ev=>{ev.preventDefault();this.saveSubConfig()});
    $('#asRefreshBtn')?.addEventListener('click',()=>this.loadSubAdmin());
    $('#asExportBtn')?.addEventListener('click',()=>this.exportSubList());
    /* 入口:hash */
    if(location.hash==='#admin')this.open();
  },
  /* 逐张识别:每张照片各自读 EXIF,返回与文件同序的参数数组('' 表示未识别) */
  async scanExif(files){
    const out=[];
    for(let i=0;i<files.length;i++){
      const tags=await Exif.read(files[i]);
      out.push(tags?Exif.fmt(tags):'');
    }
    return out;
  },
  /* 选片后:逐张识别并逐行展示每张各自的相机参数(参数按单张保存,不再整组共用) */
  async autofillExif(){
    const files=[...($('#afFiles').files||[])];
    const list=$('#afExifList');
    if(!files.length){list.hidden=true;list.innerHTML='';this._exifs=null;this.status();return}
    this.status(`已选 ${files.length} 张 · 正在逐张识别相机参数 …`);
    this._exifs=await this.scanExif(files);
    const n=this._exifs.filter(Boolean).length;
    /* HEIC/HEIF(iPhone 原生格式):浏览器普遍不能直接显示,提前预警 */
    const isHeic=f=>f.type==='image/heic'||f.type==='image/heif'||/\.hei[cf]$/i.test(f.name||'');
    const nHeic=files.filter(isHeic).length;
    list.hidden=false;
    list.innerHTML=files.map((f,i)=>`
      <div class="af-exif-row">
        <div class="af-exif-line">
          <span class="af-exif-num">${String(i+1).padStart(2,'0')}</span>
          <span class="af-exif-file" title="${esc(f.name)}">${esc(f.name)}</span>
          <span class="af-exif-val${this._exifs[i]?'':' none'}">${isHeic(f)?'<span class="af-warn">HEIC · 多数浏览器无法显示,建议相册转 JPG 后再传</span><br>':''}${this._exifs[i]?esc(this._exifs[i].replace(/<br>/g,' · ')):'未识别 · 将显示整组默认'}</span>
        </div>
        <textarea class="af-desc" data-i="${i}" rows="2" maxlength="180" placeholder="给这张照片写句介绍(可选) · 会显示在悬浮窗里"></textarea>
      </div>`).join('');
    let m=`已选 ${files.length} 张 · `;
    if(nHeic)m+=`<span class="no">${nHeic} 张为 HEIC 格式(建议转 JPG)</span> · `;
    this.status(m+(n?`识别到 ${n} 张的参数,将按单张分别保存`:'未识别到参数(可能非 JPEG 或已被压缩去除),可填写整组默认'),n?'ok':'no');
  },
  getSid(){return ($('#adminSid')&&$('#adminSid').value.trim())||storageGet('pt_cos_sid')||''},
  getSkey(){return ($('#adminSkey')&&$('#adminSkey').value.trim())||storageGet('pt_cos_skey')||''},
  /* 保存密钥:写入本机 + 提示浏览器密码管理器记住(HTTPS 下会弹"保存密码?") */
  async saveKeys(){
    const sid=$('#adminSid').value.trim(),skey=$('#adminSkey').value.trim();
    if(!sid||!skey){if($('#adminToken')&&$('#adminToken').value){this.status('管理口令已填入，仅用于本次页面','ok');return}this.status('请填写 COS 密钥，或使用备用管理口令','no');return}
    const saved=storageSet('pt_cos_sid',sid)&&storageSet('pt_cos_skey',skey);
    this.cos=null;   /* 强制下次用新密钥重建 COS 客户端 */
    let tip='密钥已保存在本机';
    try{
      if(navigator.credentials&&window.PasswordCredential){
        await navigator.credentials.store(new PasswordCredential({id:sid,password:skey,name:'Phototropic COS 密钥'}));
        tip='密钥已保存 · 浏览器会弹出"记住密码"提示,下次可一键填充';
      }else{
        tip='密钥已保存在本机(当前浏览器不支持密码管理器联动,如微信内置浏览器)';
      }
    }catch(e){tip='密钥已保存在本机(需 HTTPS 环境浏览器才会弹出记住密码)'}
    this.status(saved?tip:'浏览器禁止保存到本机，密钥仅在本次页面中使用','ok');
  },
  /* 从浏览器密码管理器带回密钥:同登录网站时弹出的账号选择器 */
  async fillKeys(){
    if(!navigator.credentials||!window.PasswordCredential){
      this.status('当前环境不支持浏览器填充(微信内置浏览器 / 非 HTTPS)· 本机已保存的密钥不受影响','no');
      return;
    }
    try{
      const c=await navigator.credentials.get({password:true});
      if(!c||!c.password){this.status('浏览器里还没有记住这组密钥 · 先填写并点"保存密钥"一次','no');return}
      $('#adminSid').value=c.id||'';
      $('#adminSkey').value=c.password||'';
      this.status('已从浏览器带回密钥 · 点"保存密钥"写入本机','ok');
    }catch(e){
      this.status('浏览器填充已取消或暂不可用','no');
    }
  },
  status(msg,cls){
    const message=String(msg||'').replace(/<\/?span(?: class="(?:ok|no)")?>/g,'').replace(/<br\s*\/?>/g,'\n');
    $('#adminStatus').innerHTML=`<span>${Store.remote?'云端作品库':'作品库连接中'} · ${this.getSid()?'本机密钥已保存':'未保存 COS 密钥'}</span><br><span id="srvState">${esc(this._serverState||'连接检测中…')}</span>`;
    if(message){const line=document.createElement('p');line.textContent=message;line.className=cls==='no'?'no':'ok';line.style.whiteSpace='pre-line';$('#adminStatus').appendChild(line)}
    if(!this._checkingServer&&Date.now()-(this._serverChecked||0)>15000)this.checkServer();
  },

  open(){
    if(!this.el)return;
    this.el.hidden=false;
    document.body.style.overflow='hidden';
    this.status();
    location.hash='#admin';
    /* 打开面板后台预取 COS SDK:等站主填好表单时已经就绪,首次上传无需等待下载 */
    if(typeof COS==='undefined'&&this.getSid()&&this.getSkey())this.loadSDK();
    this.checkServer();
    /* 密钥没填过就直接落到"站点设置",省得站主找;填过则停在常用的上传页 */
    const needKey=!this.getSid()||!this.getSkey();
    this.tab(needKey?'setup':'upload');
  },
  /* 切换功能页 */
  tab(name){
    if(!name)return;
    const tabs=$('#adminTabs');
    if(tabs){
      tabs.querySelectorAll('.atab').forEach(b=>{
        const on=b.dataset.tab===name;
        b.classList.toggle('on',on);
        b.setAttribute('aria-selected',on?'true':'false');
      });
    }
    document.querySelectorAll('.apane').forEach(p=>{
      p.classList.toggle('on',p.dataset.pane===name);
    });
    /* 切到管理页时若还没载入过,自动载入一次(省掉一次点击) */
    if(name==='manage'&&!this.mgData)this.loadManage();
    /* 切到投票活动页时,自动拉取一次投票活动配置与名单看板 */
    if(name==='vote'){this.loadVoteAdmin().then(()=>EventCenter.load())}
    /* 切到作品征集页时,自动拉取一次征集活动配置与作品墙看板 */
    if(name==='submission'){this.loadSubAdmin().then(()=>EventCenter.load())}
    if(name==='history')EventCenter.load();
  },
  /* ─── 投票活动站长管理 ─── */
  async loadVoteAdmin(){
    const sid=this.getSid(),skey=this.getSkey();
    const btn=$('#avRefreshBtn');
    if(btn){btn.disabled=true;btn.textContent='读取中…';}
    try{
      const r=await fetchWithTimeout((CONFIG.apiBase||'')+'/api/vote/admin/results',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(EventCenter.auth())
      },15000);
      const j=await r.json();
      if(!r.ok||!j.ok){
        if(r.status===403){
          this.status('需要先在「站点设置」中保存 COS 密钥才能管理投票活动并查看名单','no');
          this.tab('setup');
          return;
        }
        throw new Error(j.error||('读取失败 HTTP '+r.status));
      }
      this.voteData=j;
      this.renderVoteAdmin(j);
    }catch(e){
      this.status('读取投票数据失败:'+e.message,'no');
    }finally{
      if(btn){btn.disabled=false;btn.textContent='刷新数据';}
    }
  },
  renderVoteAdmin(data){
    const cfg=data.config||{};
    if($('#avfEnabled'))$('#avfEnabled').checked=Boolean(cfg.enabled);
    if($('#avfTitle'))$('#avfTitle').value=cfg.title||'';
    if($('#avfRules'))$('#avfRules').value=cfg.rules||'';
    if($('#avfDeadline'))$('#avfDeadline').value=String(cfg.deadline||'').replace(' ','T');
    if($('#avfMaxVotes'))$('#avfMaxVotes').value=cfg.maxVotes||1;
    if($('#avfReward'))$('#avfReward').value=cfg.reward||'';

    if($('#avTotalVotes'))$('#avTotalVotes').textContent=data.totalVotes||0;
    if($('#avTotalVoters'))$('#avTotalVoters').textContent=data.voterCount||0;

    const list=$('#avRankList');
    if(!list)return;
    if(!data.ranking||!data.ranking.length){
      list.innerHTML='<div class="mg-empty">目前还没有人投票 · 访客投票后将在此展示参选照片得票榜与 QQ 兑奖名单</div>';
      return;
    }
    list.innerHTML=data.ranking.map(item=>{
      let photoTitle='参选作品';
      (Store.groups||[]).some(g=>(g.gs||[]).some(p=>{if(p.k===item.key){photoTitle=(p.t||g.title)+' ('+g.d+')';return true}}));
      const votersHtml=item.voters.map(v=>`
        <span class="av-voter-chip" title="投票时间: ${new Date(v.ts).toLocaleString()}">
          <span>${esc(v.name||'访客')}</span>
          <b>QQ: ${esc(v.qq)}</b>
        </span>
      `).join('');
      return `
      <div class="av-rank-item">
        <div class="av-rank-thumb"><img src="${safeUrl(cosURL(item.key))}" alt="" loading="lazy" decoding="async"></div>
        <div class="av-rank-main">
          <div class="av-rank-head">
            <span class="av-rank-title">${esc(photoTitle)}</span>
            <span class="av-rank-votes">${item.count} 票</span>
          </div>
          <div class="av-voters-box">${votersHtml}</div>
        </div>
      </div>`;
    }).join('');
  },
  async saveVoteConfig(){return EventCenter.save('voting')},
  exportVoteList(){
    if(!this.voteData||!this.voteData.ranking||!this.voteData.ranking.length){
      this.status('暂无投票记录可导出','no');
      return;
    }
    const max = this.voteData.config?.maxVotes || 1;
    let txt=`=== Phototropic 摄影评选投票中奖核对名单 ===\n生成时间: ${new Date().toLocaleString()}\n活动规则: 每人可选 ${max} 张\n总投票数: ${this.voteData.totalVotes} 票 · 参与人数: ${this.voteData.voterCount} 人\n\n`;
    this.voteData.ranking.forEach((item,idx)=>{
      let photoTitle='参选作品';
      (Store.groups||[]).some(g=>(g.gs||[]).some(p=>{if(p.k===item.key){photoTitle=(p.t||g.title)+' ('+g.d+')';return true}}));
      txt+=`【第 ${idx+1} 名 · ${item.count} 票】${photoTitle}\n`;
      item.voters.forEach(v=>{
        txt+=`   · 昵称: ${v.name} | QQ: ${v.qq} | 时间: ${new Date(v.ts).toLocaleString()}\n`;
      });
      txt+='\n';
    });
    navigator.clipboard.writeText(txt).then(()=>{
      this.status('完整投票中奖核对名单已成功复制到剪贴板！','ok');
    }).catch(()=>{
      this.status('复制失败,请在后台手动查看','no');
    });
  },
  /* ─── 作品征集活动站长管理 ─── */
  async loadSubAdmin(){
    const sid=this.getSid(),skey=this.getSkey();
    const btn=$('#asRefreshBtn');
    if(btn){btn.disabled=true;btn.textContent='读取中…';}
    try{
      const r=await fetchWithTimeout((CONFIG.apiBase||'')+'/api/submission/admin/list',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(EventCenter.auth())
      },15000);
      const j=await r.json();
      if(!r.ok||!j.ok){
        if(r.status===403){
          this.status('需要先在「站点设置」中保存 COS 密钥才能管理征集活动并审核作品','no');
          this.tab('setup');
          return;
        }
        throw new Error(j.error||('读取失败 HTTP '+r.status));
      }
      this.subData=j;
      this.renderSubAdmin(j);
    }catch(e){
      this.status('读取征集作品失败:'+e.message,'no');
    }finally{
      if(btn){btn.disabled=false;btn.textContent='刷新作品';}
    }
  },
  renderSubAdmin(data){
    const cfg=data.config||{};
    if($('#asfEnabled'))$('#asfEnabled').checked=Boolean(cfg.enabled);
    if($('#asfTitle'))$('#asfTitle').value=cfg.title||'';
    if($('#asfRules'))$('#asfRules').value=cfg.rules||'';
    if($('#asfDeadline'))$('#asfDeadline').value=String(cfg.deadline||'').replace(' ','T');
    if($('#asfMaxPhotos'))$('#asfMaxPhotos').value=cfg.maxPhotos||3;
    if($('#asfReward'))$('#asfReward').value=cfg.reward||'';

    if($('#asTotalCount'))$('#asTotalCount').textContent=data.totalCount||0;
    if($('#asTotalPhotos'))$('#asTotalPhotos').textContent=data.totalPhotos||0;
    if($('#asTotalAuthors'))$('#asTotalAuthors').textContent=data.authorCount||0;

    const list=$('#asSubmissionList');
    if(!list)return;
    if(!data.items||!data.items.length){
      list.innerHTML='<div class="mg-empty">目前还没有人投稿 · 访客投递作品后将在此展示参展照片大样与联系 QQ</div>';
      return;
    }
    list.innerHTML=data.items.map((item,idx)=>{
      const photosHtml=(item.photos||[]).map((p,pi)=>`
        <div class="as-photo-thumb" data-open-url="${safeUrl(cosURL(p.k))}" tabindex="0" role="button" aria-label="打开原图">
          <img src="${safeUrl(cosURL(p.tn||p.k))}" alt="" loading="lazy" decoding="async">
          <span class="as-photo-tag">${String(pi+1).padStart(2,'0')}</span>
        </div>
      `).join('');
      return `
      <div class="as-sub-card">
        <div class="as-sub-head">
          <div class="as-sub-author">
            <span class="cm-av" style="width:24px;height:24px">${Avatar.svg(item.avatar,24)}</span>
            <span class="as-sub-title">${esc(item.title||'原创作品')} · ${esc(item.name||'访客')}</span>
          </div>
          <span class="as-sub-qq">联系 QQ: <b>${esc(item.qq)}</b></span>
          <span class="as-sub-time">${new Date(item.ts).toLocaleString()}</span>
        </div>
        <div class="as-sub-photos">${photosHtml}</div>
      </div>`;
    }).join('');
    list.querySelectorAll('.as-photo-thumb[data-open-url]').forEach(photo=>{
      const open=()=>window.open(photo.dataset.openUrl,'_blank','noopener,noreferrer');
      photo.addEventListener('click',open);
      photo.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}});
    });
  },
  async saveSubConfig(){return EventCenter.save('submissions')},
  exportSubList(){
    if(!this.subData||!this.subData.items||!this.subData.items.length){
      this.status('暂无投稿记录可导出','no');
      return;
    }
    let txt=`=== Phototropic 摄影作品征集投稿与兑奖名单 ===\n生成时间: ${new Date().toLocaleString()}\n总投稿组数: ${this.subData.totalCount} 组 · 累计照片: ${this.subData.totalPhotos} 张 · 参与人数: ${this.subData.authorCount} 人\n\n`;
    this.subData.items.forEach((item,idx)=>{
      txt+=`【第 ${idx+1} 组】《${item.title||'无题'}》\n`;
      txt+=`   · 创作者: ${item.name} | 联系QQ: ${item.qq} | 照片数: ${(item.photos||[]).length} 张\n`;
      txt+=`   · 投稿时间: ${new Date(item.ts).toLocaleString()}\n`;
      (item.photos||[]).forEach((p,pi)=>{
        txt+=`     [${pi+1}] ${cosURL(p.k)}\n`;
      });
      txt+='\n';
    });
    navigator.clipboard.writeText(txt).then(()=>{
      this.status('完整征集投稿与 QQ 兑奖名单已复制到剪贴板！','ok');
    }).catch(()=>{
      this.status('复制失败,请在后台手动查看','no');
    });
  },
  /* 检测互动后端是否可用(点赞/评论功能) */
  async checkServer(){
    if(this._checkingServer)return;
    this._checkingServer=true;
    try{
      const r=await fetchWithTimeout((CONFIG.apiBase||'')+'/api/health',{},8000),j=await r.json();
      this._serverState=r.ok&&j.ok?'互动服务正常 · '+(j.cosConfigured?'云端存储':'本地存储'):'互动数据读取异常，请检查服务端存储配置';
    }catch(error){this._serverState='暂时无法连接互动服务'}
    finally{this._checkingServer=false;this._serverChecked=Date.now();const el=$('#srvState');if(el)el.textContent=this._serverState}
  },

  close(){
    if(!this.el)return;
    this.el.hidden=true;
    document.body.style.overflow='';
    if(location.hash==='#admin')history.replaceState(null,'',location.pathname+location.search);
  },
  /* 按需加载 COS SDK:SDK 有 156KB,而访客完全用不到(只有站主上传照片才需要),
     所以不在 <head> 里同步加载,等真正要用(打开管理面板并填了密钥)时才拉取 */
  _sdkPromise:null,
  loadSDK(){
    if(typeof COS!=='undefined')return Promise.resolve(true);
    if(this._sdkPromise)return this._sdkPromise;
    this._sdkPromise=new Promise(resolve=>{
      const s=document.createElement('script');
      s.src='https://unpkg.com/cos-js-sdk-v5@1.10.1/dist/cos-js-sdk-v5.min.js';
      s.async=true;
      s.onload=()=>resolve(true);
      s.onerror=()=>{this._sdkPromise=null;resolve(false)};
      document.head.appendChild(s);
    });
    return this._sdkPromise;
  },
  /* 取得 COS 客户端(异步:首次会先加载 SDK) */
  async client(){
    if(!CONFIG.cosBucket){this.status('COS 未配置,无法上传','no');return null}
    const sid=this.getSid(),skey=this.getSkey();
    if(!sid||!skey){this.status('请先填写并保存 COS 密钥','no');return null}
    if(!this.cos){
      const ok=await this.loadSDK();
      if(!ok){this.status('COS SDK 加载失败,请检查网络后重试','no');return null}
      this.cos=new COS({SecretId:sid,SecretKey:skey});
    }
    return this.cos;
  },
  /* 上传对象。自己确保 COS 客户端已就绪:
     删除改走后端接口后不再经过 client(),若这里不主动初始化,
     在"打开面板直接删除"这种路径下 this.cos 仍是 null,写 data.json 会崩,
     导致照片已从云端删掉、前端却还显示 —— 所以在此兜底获取。 */
  async put(key,body,onProg){
    const cos=await this.client();
    if(!cos)throw new Error('COS 未就绪(密钥或 SDK 加载失败)');
    return new Promise((res,rej)=>{
      cos.putObject({Bucket:CONFIG.cosBucket,Region:CONFIG.cosRegion,Key:key,Body:body,
        ContentType:body.type||'application/octet-stream',onProgress:e=>onProg&&onProg(e)},(err,data)=>err?rej(err):res(data));
    });
  },
  /* 删除云端对象:改由后端代删。
     为什么:浏览器直连 COS 删文件是跨域 DELETE,COS 的 CORS 默认不放行 DELETE,
     浏览器会直接拦截并报 "CORS blocked or network error"。服务器不受此限制。
     鉴权沿用上传所用的同一对 COS 密钥,站长无需额外输入任何东西。 */
  async del(key){
    const auth=EventCenter.auth();
    if(!auth.token&&(!auth.sid||!auth.skey)){const error=new Error('请先保存管理凭据');error.needKey=true;throw error}
    const keys=Array.isArray(key)?key:[key],results=[];
    for(let index=0;index<keys.length;index+=40){
      const response=await fetchWithTimeout((CONFIG.apiBase||'')+'/api/photo/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...auth,keys:keys.slice(index,index+40)})},30000);
      const data=await response.json();
      if(!response.ok||!data.ok){const error=new Error(data.error||`部分文件清理失败（${data.failed||0} 个）`);if(response.status===403)error.needKey=true;throw error}
      results.push(...(data.results||[]));
    }
    return {ok:true,results};
  },

  cosURL(k){return cosURL(k)},
  /* ─── 已上传照片管理:删除 / 替换单张,改单张介绍 ───
     当前管理页的保存按顺序提交;多窗口编辑前请重新载入最新归档;
     操作完成后经事件总线 archive:reload 刷新前台,管理列表原地重渲染 */
  async loadManage(){
    /* 只读载入:公开读 data.json,无需密钥;删除/替换/保存时才要求密钥 */
    const box=$('#mgList'),btn=$('#manageLoad');
    btn.disabled=true;btn.textContent='载入中…';
    box.hidden=false;box.innerHTML='<div class="mg-empty">正在读取云端归档 …</div>';
    try{
      const data=await readCatalog('data.json','groups');
      this.mgData=data;
      this.renderManage();
      this.tnScan();       /* 检测有多少老照片还没生成预览图 */
      this.orphanScan();   /* 检测有多少记录的文件已失效 */
    }catch(err){
      box.innerHTML=`<div class="mg-empty">读取失败:${esc(err&&err.message?err.message:'未知错误')} · 请稍后重试</div>`;
    }finally{
      btn.disabled=false;btn.textContent='重新载入';
    }
  },
  renderManage(){
    const box=$('#mgList');
    const data=this.mgData;
    if(!data||!data.groups.length){box.innerHTML='<div class="mg-empty">云端归档为空 · 先在上方上传第一组照片</div>';return}
    /* 只显示"云端有内容"的组:有已上传照片的,或者本来就是空分组(站主刻意建的,
       要在管理面板里能看到它的介绍输入框并管理)。仅含旧式非 COS 照片的组与演示数据一样不显示 */
    const gs=data.groups.filter(g=>!g.gs||g.gs.length===0||g.gs.some(p=>p.k));
    if(!gs.length){box.innerHTML='<div class="mg-empty">云端归档里没有已上传的照片(当前为演示数据)</div>';return}
    box.innerHTML=gs.map(g=>{
      const photos=(g.gs||[]).map((p,i)=>{
        if(!p.k)return '';
        const ex=(p.exif||'').replace(/<br>/g,' · ');
        return `
        <div class="mg-ph" data-d="${esc(g.d)}" data-i="${i}">
          <img class="mg-thumb" src="${safeUrl(p.tn&&p.tn.s?cosURL(p.tn.s):cosURL(p.k))}" alt="${esc(p.t||'')}" title="点击在新标签打开原图" data-act="open" data-k="${esc(p.k)}" loading="lazy" decoding="async">
          <div class="mg-main">
            <div class="mg-line">
              <span class="mg-num">${String(i+1).padStart(2,'0')}</span>
              <span class="mg-t">${esc(p.t||'')}</span>
              <span class="mg-exif" title="${esc(ex)}">${esc(ex)||'无参数'}</span>
            </div>
            <label class="mg-tone-label">主要色调 <select class="mg-tone" aria-label="${esc(p.t||'作品')} 主要色调"><option value="auto">自动识别</option>${TONES.map(tone=>`<option value="${tone.id}"${p.tone?.manual&&p.tone.group===tone.id?' selected':''}>${tone.label}</option>`).join('')}</select><span>${TONES.find(tone=>tone.id===resolveTone(p,Archive.toneIndex)?.group)?.label||'待归类'}</span></label>
            <textarea class="mg-desc" rows="2" maxlength="180" placeholder="给这张照片写句介绍(可选) · 显示在悬浮窗,失焦自动保存">${esc(p.d||'')}</textarea>
            <div class="mg-acts">
              <label class="mg-btn" title="上传新照片文件替换这一张(会重新识别参数)">替换照片<input type="file" accept="image/*" class="mg-file" hidden></label>
              <button type="button" class="mg-btn danger" data-act="del">删除这张</button>
            </div>
          </div>
        </div>`;
      }).join('');
      const n=(g.gs||[]).filter(p=>p.k).length;
      /* 空分组:不显示"删除整组"之外的尴尬空块,改为一条说明 + 整组介绍输入框 */
      const empty=n?photos:`<div class="mg-blank">这一组还没有照片 · 访客可以在组页看到介绍并留言</div>
        <div class="mg-main">
          <textarea class="mg-desc mg-gdesc" rows="2" maxlength="300" placeholder="整组介绍(可选) · 显示在组详情页,失焦自动保存">${esc(g.c||'')}</textarea>
        </div>`;
      return `
      <div class="mg-group" data-d="${esc(g.d)}">
        <div class="mg-g-head">
          <span>${esc(g.d)}</span>
          <span class="mg-g-title">${esc(g.title||'')}</span>
          <span>${esc(g.loc||'')}</span>
          <span>${n?n+'/'+g.gs.length+' 张':'空分组'}</span>
          <span class="mg-g-act"><button type="button" class="mg-btn danger" data-act="gdel">删除整组</button></span>
        </div>
        ${empty}
      </div>`;
    }).join('');
  },
  mgSave(okMsg){
    const task=(this._saveChain||Promise.resolve()).catch(()=>{}).then(async()=>{
      await this.put('data.json',new Blob([JSON.stringify(this.mgData,null,1)],{type:'application/json'}));
      await Bus.emit('archive:reload');this.renderManage();if(okMsg)this.status(okMsg,'ok');
    });
    this._saveChain=task;return task;
  },

  /* ─── 清理"记录还在、文件已没了"的残影照片 ───
     曾经的删除缺陷会让照片从云端删掉、但 data.json 里的记录没同步移除,
     访客端就会看到破图。这里逐个探测文件是否还存在于云端,把失效记录摘掉。 */
  orphanScan(){
    const box=$('#orphanBox'),info=$('#orphanInfo');
    if(!box||!info)return;
    const data=this.mgData;
    if(!data||!data.groups.length){box.hidden=true;return}
    let total=0;
    data.groups.forEach(g=>{(g.gs||[]).forEach(p=>{if(p.k)total++})});
    box.hidden=false;
    info.innerHTML=`将逐张检查这 <b>${total} 张</b>照片的云端文件是否还在。若发现已被删除却仍留在列表里的,会被清理掉。`;
    const btn=$('#orphanBtn');
    if(btn){btn.disabled=false;btn.textContent='检查并清理失效照片'}
  },
  async orphanRebuild(){
    const data=this.mgData;
    if(!data)return;
    const btn=$('#orphanBtn');
    btn.disabled=true;
    this.status('正在检查云端文件是否都存在 …');
    /* 1. 收集所有待检查的 key */
    const targets=[];
    data.groups.forEach(g=>{(g.gs||[]).forEach((p,i)=>{if(p.k)targets.push({g,p,i})})});
    if(!targets.length){this.status('没有可检查的照片','ok');btn.disabled=false;return}
    /* 2. 并发探测(HEAD 请求,只读头部不下载内容) */
    const missing=[];
    let done=0;
    const CONC=6;
    let cursor=0;
    const worker=async()=>{
      while(cursor<targets.length){
        const t=targets[cursor++];
        try{
          const r=await fetchWithTimeout(cosURL(t.p.k),{method:'HEAD',cache:'no-store'},8000);
          if(r.status===404)missing.push(t);
        }catch(e){
          /* 网络错误不当作文件缺失,避免误删记录 */
        }
        done++;
        if(done%5===0||done===targets.length){
          btn.textContent=`检查中 ${done}/${targets.length} …`;
        }
      }
    };
    await Promise.all(Array.from({length:CONC},worker));
    /* 3. 摘掉失效记录 */
    if(!missing.length){
      this.status(`检查完成:${targets.length} 张照片的云端文件都在,没有失效记录`,'ok');
      btn.disabled=false;btn.textContent='重新检查';
      return;
    }
    if(!confirm(`发现 ${missing.length} 张照片的云端文件已不存在,但列表里还留着(访客会看到破图)。\n\n现在把这些失效记录从列表里清理掉吗?\n(只改列表数据,不会删除任何文件)`)) {
      btn.disabled=false;btn.textContent='重新检查';
      return;
    }
    /* 按组处理:从后往前删,避免索引错位 */
    const byGroup=new Map();
    missing.forEach(t=>{
      if(!byGroup.has(t.g))byGroup.set(t.g,[]);
      byGroup.get(t.g).push(t.i);
    });
    let removed=0;
    byGroup.forEach((idxs,g)=>{
      idxs.sort((a,b)=>b-a).forEach(i=>{g.gs.splice(i,1);removed++});
      /* 只移除"因这次清理而变空"的组;本来就是空的组(只有介绍和留言)保留 */
      if(!g.gs.length)data.groups=data.groups.filter(x=>x!==g);
    });
    try{
      await this.mgSave(`已清理 ${removed} 条失效记录`);
    }catch(e){
      this.status('清理失败:'+((e&&e.message)||'请检查网络'),'no');
    }
    btn.disabled=false;btn.textContent='重新检查';
    this.renderManage();
    this.orphanScan();
  },
  /* ─── 老照片补预览图 ───
     早期上传的照片没有压缩版,访客浏览会下原图(12~20MB)导致卡顿。
     这里逐个下载原图 → 浏览器内压成 480/1600 → 上传到 COS → 回写 data.json */
  tnScan(){
    const box=$('#tnFixBox'),info=$('#tnFixInfo');
    if(!box||!info)return;
    const data=this.mgData;
    if(!data||!data.groups.length){box.hidden=true;return}
    const todo=[];
    data.groups.forEach(g=>{
      (g.gs||[]).forEach((p,i)=>{if(p.k&&!(p.tn&&p.tn.s))todo.push({g,p,i})});
    });
    box.hidden=false;
    if(!todo.length){
      info.innerHTML='全部照片都已生成预览图,访客端已是最快状态。';
      $('#tnFixBtn').disabled=true;
      $('#tnFixBtn').textContent='无需处理';
      return;
    }
    info.innerHTML=`检测到 <b>${todo.length} 张</b>老照片还没有预览图,访客打开它们时会下载十几 MB 的原图。`;
    $('#tnFixBtn').disabled=false;
    $('#tnFixBtn').textContent='为这 '+todo.length+' 张生成预览图';
  },
  async tnRebuild(){
    const cos=await this.client();
    if(!cos)return;
    const data=this.mgData;
    if(!data)return;
    const todo=[];
    data.groups.forEach(g=>{
      (g.gs||[]).forEach((p,i)=>{if(p.k&&!(p.tn&&p.tn.s))todo.push({g,p,i})});
    });
    if(!todo.length){this.status('没有需要处理的照片','ok');return}
    if(!confirm(`将为 ${todo.length} 张照片生成并上传预览图。\n\n原图不会被修改或删除,只是额外存两个小版本。\n过程中请保持页面打开,不要关闭。\n\n开始吗?`))return;
    const btn=$('#tnFixBtn');
    btn.disabled=true;
    const t0=Date.now();
    let done=0,fail=0,savedKB=0;
    for(const item of todo){
      const {g,p,i}=item;
      btn.textContent=`处理中 ${done+fail+1}/${todo.length} …`;
      this.status(`正在生成预览图 ${done+fail+1}/${todo.length} · ${p.t||''}`);
      try{
        /* 1. 下载原图(带 crossOrigin 才能进 canvas 导出) */
        const url=cosURL(p.k);
        const resp=await fetchWithTimeout(url,{mode:'cors'},30000);
        if(!resp.ok)throw new Error('原图下载失败 '+resp.status);
        const srcBlob=await resp.blob();
        /* 2. 压成两档并上传 */
        const smallBlob=await Thumb.make(srcBlob,Thumb.SMALL,Thumb.Q_SMALL);
        const smallKey=Thumb.key(p.k,Thumb.SMALL);
        await this.put(smallKey,smallBlob);
        const viewBlob=await Thumb.make(srcBlob,Thumb.VIEW,Thumb.Q_VIEW);
        const viewKey=Thumb.key(p.k,Thumb.VIEW);
        await this.put(viewKey,viewBlob);
        /* 3. 记录小图 key(原图与小图大小对比,用于展示省了多少流量) */
        p.tn={s:smallKey,v:viewKey};
        savedKB+=Math.max(0,(srcBlob.size-smallBlob.size)/1024);
        done++;
      }catch(e){
        fail++;
        console.warn('预览图生成失败:',p.k,e&&e.message);
      }
      /* 每张处理完就写回一次,中途中断也不会全部白做 */
      if(done%3===0||done+fail===todo.length){
        try{await this.put('data.json',new Blob([JSON.stringify(data,null,1)],{type:'application/json'}))}catch(e){}
      }
    }
    /* 最终写回 + 刷新访客端数据 */
    try{
      await this.put('data.json',new Blob([JSON.stringify(data,null,1)],{type:'application/json'}));
      await Bus.emit('archive:reload');
    }catch(e){}
    const sec=Math.round((Date.now()-t0)/1000);
    this.status(`预览图完成:成功 ${done} 张${fail?` · <span class="no">失败 ${fail} 张(可重试)</span>`:''} · 耗时 ${sec} 秒<br>访客端每次浏览约省下 <span class="ok">${Math.round(savedKB/1024)} MB</span> 流量,照片打开速度大幅提升`,fail?'no':'ok');
    btn.disabled=false;
    btn.textContent='重新检测';
    this.tnScan();
    this.renderManage();
  },
  async mgDelete(d,i){
    const g=this.mgData&&this.mgData.groups.find(x=>x.d===d);
    if(this._mediaBusy||!g||!g.gs[i]||!g.gs[i].k)return;
    if(!confirm(`确定删除「${g.gs[i].t||d}」？云端文件将一并清理。`))return;
    const photo=g.gs[i],keys=[photo.k];
    if(photo.tn){if(photo.tn.s)keys.push(photo.tn.s);if(photo.tn.v)keys.push(photo.tn.v)}
    this._mediaBusy=true;
    try{
      g.gs.splice(i,1);
      try{await this.mgSave()}catch(error){g.gs.splice(i,0,photo);throw error}
      try{await this.del(keys);this.status('照片已移除，空分组会保留','ok')}
      catch(error){this.status('列表已更新，但文件清理失败：'+error.message+'。可在云存储中检查这些文件。','no')}
    }catch(error){this.status('删除未完成，原照片已保留：'+error.message,'no')}
    finally{this._mediaBusy=false;this.renderManage()}
  },
  async mgDeleteGroup(d){
    const g=this.mgData&&this.mgData.groups.find(x=>x.d===d);
    if(this._mediaBusy||!g)return;
    if(!confirm(`确定删除整组「${g.title||d}」？列表和云端照片将被移除。`))return;
    const previous=this.mgData.groups.slice(),keys=[];
    (g.gs||[]).forEach(photo=>{if(photo.k)keys.push(photo.k);if(photo.tn){if(photo.tn.s)keys.push(photo.tn.s);if(photo.tn.v)keys.push(photo.tn.v)}});
    this._mediaBusy=true;
    try{
      this.mgData.groups=this.mgData.groups.filter(item=>item!==g);
      try{await this.mgSave()}catch(error){this.mgData.groups=previous;throw error}
      try{if(keys.length)await this.del(keys);this.status('整组已移除','ok')}
      catch(error){this.status('列表已更新，但部分文件未清理：'+error.message,'no')}
    }catch(error){this.status('删除未完成，整组原照片已保留：'+error.message,'no')}
    finally{this._mediaBusy=false;this.renderManage()}
  },
  /* 删除失败时的统一提示 */
  delFail(err){
    const raw=(err&&err.message)||'';
    if(err&&err.needKey){
      this.tab('setup');
      this.status('删除需要先保存 COS 密钥:请在「站点设置」里填写密钥并保存(与上传照片用的是同一对)。','no');
    }else{
      this.status('删除失败:'+(raw||'请检查网络后重试'),'no');
    }
    this.renderManage();
  },
  async mgReplace(d,i,file){
    const g=this.mgData&&this.mgData.groups.find(x=>x.d===d);
    if(!g||!g.gs[i])return;
    if(!file||this._mediaBusy)return;
    this._mediaBusy=true;
    const previous={...g.gs[i]};
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
    const key=`photos/${d}/${i+1}_${Date.now()}.${ext}`;
    this.status(`替换中 · 正在上传 ${file.name} …`);
    try{
      /* 新文件重新识别参数(未识别则保留这张原参数) */
      const ex=await this.scanExif([file]);
      await this.put(key,file);
      const old=g.gs[i].k;
      const oldTn=g.gs[i].tn;
      g.gs[i].k=key;
      delete g.gs[i].tn;   /* 换了新图,旧小图作废 */
      delete g.gs[i].tone;
      if(ex&&ex[0])g.gs[i].exif=ex[0];
      /* 为新图生成小版本(与上传流程一致,否则这张会回退到加载原图) */
      try{
        const small=await Thumb.make(file,Thumb.SMALL,Thumb.Q_SMALL);
        g.gs[i].tone=await analyzeBlob(small);
        const sk=Thumb.key(key,Thumb.SMALL);
        await this.put(sk,small);
        const view=await Thumb.make(file,Thumb.VIEW,Thumb.Q_VIEW);
        const vk=Thumb.key(key,Thumb.VIEW);
        await this.put(vk,view);
        g.gs[i].tn={s:sk,v:vk};
      }catch(e){console.warn('替换后生成预览图失败:',e&&e.message)}
      await this.mgSave('照片已替换');
      /* 新图就位后才清理旧文件(含旧小图),失败不阻断 */
      if(old&&old!==key){
        const rm=[old];
        if(oldTn){if(oldTn.s)rm.push(oldTn.s);if(oldTn.v)rm.push(oldTn.v)}
        try{await this.del(rm)}catch(e){}
      }
    }catch(err){
      g.gs[i]=previous;
      this.status('替换失败:'+(err&&err.message?err.message:'请检查密钥/网络'),'no');
      this.renderManage();
    }finally{this._mediaBusy=false}
  },
  async mgDescSave(d,i,val){
    /* 只写 data.json(用 COS SDK 的 PUT,CORS 允许),无需口令 */
    const g=this.mgData&&this.mgData.groups.find(x=>x.d===d);
    if(!g||!g.gs[i])return;
    const v=(val||'').trim();
    if(v===((g.gs[i].d||'').trim()))return;   /* 未变化不写云端 */
    const previous=g.gs[i].d;
    g.gs[i].d=v;
    try{
      await this.mgSave(v?'介绍已保存':'介绍已清空');
    }catch(err){
      g.gs[i].d=previous;
      this.status('保存介绍失败:'+(err&&err.message?err.message:''),'no');
    }
  },
  async mgToneSave(day,index,group){
    const photo=this.mgData?.groups.find(item=>item.d===day)?.gs[index];
    if(!photo||this._mediaBusy)return;
    this._mediaBusy=true;
    const previous=photo.tone;
    try{
      if(group==='auto'){
        if(!photo.tn?.s)throw new Error('请先生成这张作品的预览图');
        const response=await fetchWithTimeout(cosURL(photo.tn.s));
        if(!response.ok)throw new Error('缩略图读取失败');
        photo.tone=await analyzeBlob(await response.blob());
      }else{
        if(!TONES.some(tone=>tone.id===group))throw new Error('色调无效');
        photo.tone={version:1,group,palette:resolveTone(photo,Archive.toneIndex)?.palette||[TONES.find(tone=>tone.id===group).color],manual:true};
      }
      await this.mgSave('作品色调已保存');
    }catch(error){
      if(previous)photo.tone=previous;else delete photo.tone;
      this.renderManage();this.status('色调保存失败：'+error.message,'no');
    }finally{this._mediaBusy=false}
  },
  /* 整组介绍:写给"这一组"的文字,空分组也适用(与单张介绍分开保存) */
  async mgGroupDescSave(d,val){
    const g=this.mgData&&this.mgData.groups.find(x=>x.d===d);
    if(!g)return;
    const v=(val||'').trim();
    if(v===((g.c||'').trim()))return;
    const previous=g.c;
    g.c=v;
    try{
      await this.mgSave(v?'整组介绍已保存':'整组介绍已清空');
    }catch(err){
      g.c=previous;
      this.status('保存整组介绍失败:'+(err&&err.message?err.message:''),'no');
    }
  },
  readFileText(f){
    return new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=()=>res(r.result);
      r.onerror=()=>rej(new Error('读取文件失败'));
      r.readAsText(f);
    });
  },
  /* ─── 站点发布:把当前页面源码存入 COS 的 index.html,作为一份云端备份 ───
     线上正式页面由 GitHub + Render 托管,改完推送仓库约 40 秒自动生效;
     这里存的一份是给站主留的"回到任意版本"用的底稿。 */
  async publishSite(){
    const cos=await this.client();
    if(!cos)return;
    const btn=$('#adminPublish'),out=$('#pubOut');
    btn.disabled=true;btn.textContent='发布中…';
    out.hidden=true;
    try{
      /* 1. 取页面源码:优先抓当前地址(须是完整源码而非运行后的 DOM),异常时回退手动选文件 */
      let src='';
      try{
        const r=await fetchWithTimeout(location.href,{cache:'no-store'},10000);
        if(r.ok){
          const t=await r.text();
          if(/<!doctype html/i.test(t)&&/Phototropic/i.test(t))src=t;
        }
      }catch(e){}
      if(!src){
        const f=$('#pfFile').files&&$('#pfFile').files[0];
        if(f)src=await this.readFileText(f);
      }
      if(!src){this.status('未能取得页面源码:请点上方选择文件,选定 index.html 后再发布','no');return}
      const assets = ['assets/app.js','assets/site.css','assets/tone-index.json',
        ...['spring','autumn'].flatMap(kind => [0,1,2].map(index => `assets/season/${kind}-${index}.webp`)), 'assets/season/ATTRIBUTION.md'];
      const responses = await Promise.all(assets.map(asset => fetchWithTimeout('/'+asset)));
      if(responses.some(response => !response.ok))throw new Error('页面资源读取失败，未写入不完整备份');
      const blobs = await Promise.all(responses.map(response => response.blob()));
      this.status('正在备份页面与浏览资源…');
      for(let index=0;index<assets.length;index++)await this.put(assets[index],blobs[index]);
      await this.put('index.html',new Blob([src],{type:'text/html; charset=utf-8'}));
      this.status('页面与浏览资源已备份','ok');
      out.hidden=false;out.textContent='已备份 index.html、脚本、样式、色调索引与季节素材。正式网站版本仍由 GitHub 中的代码和部署平台管理。';

    }catch(err){
      this.status('发布失败:'+(err&&err.message?err.message:'请检查密钥与存储桶权限'),'no');
      out.hidden=true;
    }finally{
      btn.disabled=false;btn.textContent='备份当前页面';
    }
  },
  prog(pct,txt){
    $('#adminProg').hidden=false;
    $('#adminProgBar').style.width=pct+'%';
    $('#adminProgTxt').textContent=txt;
  },
  /* ─── 背景音乐上传:音频入 COS music/,曲目清单读写 music.json(与照片的 data.json 分离) ─── */
  async uploadMusic(){
    const cos=await this.client();
    if(!cos)return;
    const files=[...$('#mfFiles').files];
    if(!files.length){this.status('请先选择音频文件','no');return}
    const btn=$('#musicUpload');
    btn.disabled=true;btn.textContent='上传中…';
    try{
      /* 1. 读现有 music.json(追加而非覆盖) */
      const data=await readCatalog('music.json','tracks');
      /* 2. 逐个上传(失败重试 1 次,跳过坏文件,不毁整批) */
      const fails=[];
      for(let i=0;i<files.length;i++){
        const f=files[i];
        const ext=(f.name.split('.').pop()||'mp3').toLowerCase().replace(/[^a-z0-9]/g,'')||'mp3';
        const key=`music/${Date.now()}_${i+1}.${ext}`;
        let ok=false;
        for(let a=0;a<2&&!ok;a++){
          try{await this.put(key,f);ok=true}
          catch(e){await new Promise(r=>setTimeout(r,800))}
        }
        if(ok)data.tracks.push({k:key,t:f.name.replace(/\.[^.]+$/,'').slice(0,40)||'背景乐'});
        else fails.push(String(i+1));
      }
      if(!data.tracks.length)throw new Error('全部音频上传失败,请检查密钥/网络');
      /* 3. 写回清单 */
      await this.put('music.json',new Blob([JSON.stringify(data,null,1)],{type:'application/json'}));
      this.status(`背景音乐已保存:曲库共 ${data.tracks.length} 首${fails.length?` · <span class="no">第 ${fails.join('、')} 个文件失败已跳过</span>`:''},访客页右下角即出现唱片`,fails.length?'no':'ok');
      $('#mfFiles').value='';
      Player.init();   /* 免刷新,唱片立即就位 */
    }catch(err){
      this.status('音乐上传失败:'+(err&&err.message?err.message:'请检查密钥与存储桶权限'),'no');
    }finally{
      btn.disabled=false;btn.textContent='上传背景音乐';
    }
  },
  async upload(){
    const cos=await this.client();
    if(!cos)return;
    const d=$('#afDate').value;
    const title=$('#afTitle').value.trim();
    const loc=$('#afLoc').value.trim()||'—';
    const desc=$('#afDesc').value.trim()||'';
    const exif=$('#afExif').value.trim()||'';
    const files=[...$('#afFiles').files];
    /* 照片改为可选:不选照片时走"只建空分组"路径(仍会写 data.json) */
    if(!d||!title){this.status('日期与标题为必填','no');return}
    const btn=$('#adminSubmit');
    btn.disabled=true;btn.textContent=files.length?'上传中…':'建组中…';
    try{
      /* 1. 读现有 data.json(公有读直链) */
      const data=await readCatalog('data.json','groups');
      /* ── 没有选照片:只建/更新这一组的资料,组内照片为空 ── */
      if(!files.length){
        const msg=this.upsertGroup(data,d,{loc,title,desc,exif});
        this.prog(60,'保存归档数据…');
        await this.put('data.json',new Blob([JSON.stringify(data,null,1)],{type:'application/json'}));
        this.prog(100,'完成');
        this.status(msg,'ok');
        $('#afDesc').value='';$('#afExif').value='';
        this._exifs=null;
        const xl0=$('#afExifList');xl0.hidden=true;xl0.innerHTML='';
        await Bus.emit('archive:reload');
        return;
      }
      /* 2. 逐张识别参数(选片时已扫过则复用)+ 逐张上传,每张携带各自的 EXIF */
      if(!this._exifs||this._exifs.length!==files.length){
        this.prog(2,'识别相机参数 …');
        this._exifs=await this.scanExif(files);
      }
      const gs=[];
      /* 逐张介绍:上传面板里每张照片各有一条可填的说明文字(可选),随照片一并入库 */
      const _dc={};
      $('#afExifList').querySelectorAll('textarea.af-desc').forEach(td=>{const v=(td.value||'').trim();if(v)_dc[+td.dataset.i]=v});
      /* 逐张上传:每张失败自动重试 1 次,仍失败则跳过继续,不让一张坏片/一次网络抖动毁掉整批
         (data.json 只在循环结束后写,跳过的照片不入库,补传时同一日期会自动并入同组) */
      const fails=[];
      for(let i=0;i<files.length;i++){
        const f=files[i];
        const ext=(f.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
        const key=`photos/${d}/${i+1}_${Date.now()}.${ext}`;
        let ok=false;
        for(let a=0;a<2&&!ok;a++){
          this.prog(Math.round((i+a*0.3)/files.length*90),(a?`第 ${i+1} 张失败,重试中 …`:`上传照片 ${i+1}/${files.length}`));
          try{await this.put(key,f);ok=true}
          catch(e){await new Promise(r=>setTimeout(r,800))}   /* 间隔 0.8s 再试,避开瞬时限流 */
        }
        if(ok){
          const ph={t:`${title} · ${String(i+1).padStart(2,'0')}`,k:key,exif:this._exifs[i]||''};
          if(_dc[i])ph.d=_dc[i];
          /* ── 生成并上传小图(480 + 1600) ──
             这一步是"访客端不卡"的关键:原图 12~20MB 留在云端不动,
             另外存两个压缩版,访客平常只看小版本。
             小图上传失败不影响照片入库(只是访客端回退原图),不阻断整批。 */
          this.prog(Math.round((i+0.5)/files.length*90),`生成预览图 ${i+1}/${files.length} …`);
          try{
            const small=await Thumb.make(f,Thumb.SMALL,Thumb.Q_SMALL);
            ph.tone=await analyzeBlob(small);
            const smallKey=Thumb.key(key,Thumb.SMALL);
            await this.put(smallKey,small);
            const view=await Thumb.make(f,Thumb.VIEW,Thumb.Q_VIEW);
            const viewKey=Thumb.key(key,Thumb.VIEW);
            await this.put(viewKey,view);
            ph.tn={s:smallKey,v:viewKey};
          }catch(e){
            /* 压缩或上传失败:这张照常入库,访客端自动回退原图 */
            console.warn('预览图生成失败('+key+'):',e&&e.message);
          }
          gs.push(ph);
        }
        else fails.push(String(i+1));
      }
      if(!gs.length)throw new Error('所有照片均上传失败,请检查密钥/存储桶/网络后重试');
      /* 3. 更新组数据(同日期则追加照片) */
      this.upsertGroup(data,d,{loc,title,desc,exif},gs);
      /* 4. 写回 data.json */
      this.prog(95,'保存归档数据…');
      await this.put('data.json',new Blob([JSON.stringify(data,null,1)],{type:'application/json'}));
      this.prog(100,'完成');
      this.status(`上传成功:${gs.length}/${files.length} 张已归入 ${d}`+(fails.length?` · <span class="no">第 ${fails.join('、')} 张失败已跳过,可单独补传</span>`:''),fails.length?'no':'ok');
      $('#adminForm').reset();
      $('#afDate').value=d;
      this._exifs=null;
      const xl=$('#afExifList');xl.hidden=true;xl.innerHTML='';
      /* 5. 通过事件总线刷新归档(Admin 不直调 Store/Archive,模块解耦) */
      await Bus.emit('archive:reload');
    }catch(err){
      this.status('上传失败:'+(err&&err.message?err.message:'请检查密钥/存储桶名/地域是否正确'),'no');
    }finally{
      btn.disabled=false;btn.textContent='开始上传';
      setTimeout(()=>{$('#adminProg').hidden=true},2500);
    }
  },
  /* 建组 / 并入已有组:同日期则更新资料并追加照片,否则新建一组。
     新组用 unshift 排在最前,空组与有照片的组一视同仁(不再被过滤掉) */
  upsertGroup(data,d,info,gs){
    const exist=data.groups.find(g=>g.d===d);
    const n=(gs&&gs.length)||0;
    if(exist){
      if(!Array.isArray(exist.gs))exist.gs=[];
      if(n)exist.gs.push(...gs);
      if(info.loc&&info.loc!=='—')exist.loc=info.loc;
      if(info.title)exist.title=info.title;
      if(info.desc)exist.c=info.desc;
      if(info.exif)exist.exif=info.exif;
      return n?`已并入 ${d} 这一组(新增 ${n} 张)`:`已更新 ${d} 这一组的资料`;
    }
    data.groups.unshift({d,loc:info.loc,title:info.title,c:info.desc,exif:info.exif,gs:gs||[]});
    return n?`新组已建立:${d} · ${n} 张`:`空分组已建立:${d} · 可进入组页写介绍与留言`;
  },
  /* 「只建空分组」按钮:表单里没选照片时也能直接建组 */
  async blankGroup(){
    const d=$('#afDate').value,title=$('#afTitle').value.trim();
    if(!d||!title){this.status('日期与标题为必填 · 建空组至少要有这两项','no');return}
    if([...($('#afFiles').files||[])].length){
      this.status('已选了照片 · 直接用「开始上传」即可','no');return;
    }
    return this.upload();
  }
};

const EventCenter=createEventCenter({$,esc,fetchWithTimeout,CONFIG,Admin,Vote,Submission});
const Dialogs=setupDialogs({
  lightbox:()=>Lightbox.close(),voteNoticeModal:()=>Vote.closeNotice(),
  voteBoardModal:()=>Vote.closeBoard(),subBoardModal:()=>Submission.closeBoard(),adminPanel:()=>Admin.close()
});
// Error labels remain usable even when a remote thumbnail is missing.
document.addEventListener('error',event=>{if(event.target.tagName==='IMG'&&event.target.parentElement)event.target.parentElement.classList.add('image-error')},true);
// Older iOS and in-app engines understand grid gap but may lack flex gap.
(function(){const row=document.createElement('div');row.style.cssText='display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';row.appendChild(document.createElement('span'));row.appendChild(document.createElement('span'));document.body.appendChild(row);if(row.scrollHeight!==1)document.documentElement.classList.add('no-flexgap');row.remove()})();
// Device flags control only optional enhancements; every device has the same functionality.
if(matchMedia('(pointer:coarse)').matches||innerWidth<760)document.documentElement.classList.add('lite');
/* ─── 启动 ─── */
Social.init();   /* 访客身份(随机名字+头像) + 拉取点赞评论数据,内部先跑 Identity.init() */
(async()=>{
  const ok=await Store.init();
  if(!ok&&!Store.groups.length)Store.setDemo();   /* 远程 data.json 存在则替换演示数据 */
  Archive.init();
  if(!$('#voteBoardModal').hidden){Vote.renderGrid();Vote.updateBar();}
})();
/* 事件总线:上传完成后由 Admin 发出 archive:reload,Store/Archive 自主监听刷新(模块解耦) */
Bus.on('archive:reload',async()=>{
  const ok=await Store.init();
  if(!ok)throw new Error('归档刷新失败,已保留当前列表');
  //   /* 远程 data.json 瞬时读取失败时回退演示数据,避免档案空白 */
  Archive.init();
  if(!$('#voteBoardModal').hidden){Vote.renderGrid();Vote.updateBar();}
});
GroupPage.init();
Lightbox.init();
Admin.init();
Player.init();   /* 有曲目才显示唱片;访客默认静音 */
Vote.init();     /* 投票活动生命周期管理与弹窗入口 */
Submission.init();
EventCenter.init();
Motion.start();
createSeasons({Motion,storageGet,storageSet}).start();

(function(){
  const root=document.documentElement,btn=$('#themeBtn');
  const apply=theme=>{
    root.setAttribute('data-theme',theme);
    btn.setAttribute('aria-checked',String(theme==='bright'));
    btn.setAttribute('aria-label',theme==='bright'?'切换到深色主题':'切换到浅色主题');
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta){const bg=getComputedStyle(root).getPropertyValue('--bg').trim();meta.content=bg||(theme==='bright'?'#f7f5f4':'#0e131a');}
  };
  apply(storageGet('pt_theme','bright')==='dark'?'dark':'bright');
  btn.addEventListener('click',()=>{const theme=root.getAttribute('data-theme')==='bright'?'dark':'bright';apply(theme);storageSet('pt_theme',theme)});
})();


})();  /* 主应用 IIFE 结束 */
