/**
 * Phototropic 摄影归档 · 点赞与评论后端
 *
 * 提供:
 *   GET  /api/health             健康检查
 *   GET  /api/interactions       全站互动数据(点赞/评论)
 *   POST /api/like               点赞或取消点赞
 *   POST /api/comment            发表评论
 *   POST /api/comment/delete     删除评论(本人删自己的)
 *   GET  /                       托管网页(index.html)
 *
 * 数据存放:腾讯云 COS 的 interactions.json(内存缓存 + 写穿透)
 * 凭据来源:环境变量 COS_SECRET_ID / COS_SECRET_KEY(不写死在代码里)
 */

'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const COS = require('cos-nodejs-sdk-v5');

/* ─────────── 配置 ─────────── */
const COS_BUCKET = process.env.COS_BUCKET || 'zhao-1465501838';
const COS_REGION = process.env.COS_REGION || 'ap-nanjing';
const COS_SECRET_ID = process.env.COS_SECRET_ID || '';
const COS_SECRET_KEY = process.env.COS_SECRET_KEY || '';
const DATA_KEY = process.env.DATA_KEY || 'interactions.json';
const PORT = process.env.PORT || 3000;

const MAX_NAME = 24;
const MAX_COMMENT = 500;
const MAX_COMMENTS_PER_PHOTO = 500;
const MAX_BODY = 64 * 1024;

const cos = new COS({
  SecretId: COS_SECRET_ID,
  SecretKey: COS_SECRET_KEY,
  Timeout: 15000,
});

/* ─────────── COS 读写(官方 SDK,自动处理签名) ─────────── */
function cosGet(key) {
  return new Promise((resolve, reject) => {
    if (!COS_SECRET_ID || !COS_SECRET_KEY) {
      return reject(new Error('COS 密钥未配置(缺少环境变量 COS_SECRET_ID / COS_SECRET_KEY)'));
    }
    cos.getObject(
      { Bucket: COS_BUCKET, Region: COS_REGION, Key: key },
      (err, data) => {
        if (err) {
          // 文件不存在(首次部署)不算错误,交给调用方按空数据启动
          if (err.statusCode === 404 || /NoSuchKey/i.test(err.message || '')) return resolve(null);
          return reject(err);
        }
        resolve(data.Body ? data.Body.toString('utf8') : null);
      }
    );
  });
}

function cosPut(key, text) {
  return new Promise((resolve, reject) => {
    if (!COS_SECRET_ID || !COS_SECRET_KEY) {
      return reject(new Error('COS 密钥未配置(缺少环境变量 COS_SECRET_ID / COS_SECRET_KEY)'));
    }
    cos.putObject(
      {
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Body: Buffer.from(text, 'utf8'),
        ContentType: 'application/json; charset=utf-8',
      },
      (err, data) => (err ? reject(err) : resolve(data))
    );
  });
}

function cosPutBuffer(key, buffer, contentType = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    if (!COS_SECRET_ID || !COS_SECRET_KEY) {
      return reject(new Error('COS 密钥未配置(缺少环境变量 COS_SECRET_ID / COS_SECRET_KEY)'));
    }
    cos.putObject(
      {
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      },
      (err, data) => (err ? reject(err) : resolve(data))
    );
  });
}

/**
 * 删除 COS 对象。
 * 为什么删除要由服务器代做:浏览器直连 COS 删文件是跨域 DELETE 请求,
 * 腾讯云 CORS 需显式放行 DELETE,未放行时浏览器会直接拦截(报 CORS blocked)。
 * 服务器之间通信不走浏览器 CORS,因此把删除放到后端最稳妥。
 */
function cosDelete(key) {
  return new Promise((resolve, reject) => {
    if (!COS_SECRET_ID || !COS_SECRET_KEY) {
      return reject(new Error('COS 密钥未配置(缺少环境变量 COS_SECRET_ID / COS_SECRET_KEY)'));
    }
    cos.deleteObject(
      { Bucket: COS_BUCKET, Region: COS_REGION, Key: key },
      (err, data) => {
        // 文件本来就不存在,视为删除成功(幂等)
        if (err && (err.statusCode === 404 || /NoSuchKey/i.test(err.message || ''))) {
          return resolve({ alreadyGone: true });
        }
        return err ? reject(err) : resolve(data);
      }
    );
  });
}

/* ─────────── 存储层:配置了 COS 就用 COS,否则退回本地文件(便于本机试用) ─────────── */
const LOCAL_FILE = path.join(__dirname, 'data', 'interactions.json');
const useCos = Boolean(COS_SECRET_ID && COS_SECRET_KEY);

function localGet() {
  try {
    return fs.readFileSync(LOCAL_FILE, 'utf8');
  } catch (e) {
    return null; // 首次运行,文件还不存在
  }
}

function localPut(text) {
  fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_FILE, text, 'utf8');
}

function localPutBuffer(key, buffer) {
  const p = path.join(__dirname, 'data', key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buffer);
}

const storageGet = (key) => (useCos ? cosGet(key) : Promise.resolve(localGet()));
const storagePut = (key, text) => (useCos ? cosPut(key, text) : Promise.resolve(localPut(text)));
const storagePutBuffer = (key, buffer, type) => (useCos ? cosPutBuffer(key, buffer, type) : Promise.resolve(localPutBuffer(key, buffer)));

/* 本地模式下的"删除":仅做存在性校验 */
const storageDelete = (key) => (useCos ? cosDelete(key) : Promise.resolve({ local: true }));

/* ─────────── 数据层:内存缓存 + 写穿透 ─────────── */
let store = { photos: {} };
let loaded = false;
let loadError = null;
let writeChain = Promise.resolve();

const EMPTY = () => ({ likes: [], comments: [] });

function normalize(raw) {
  const out = {
    photos: {},
    voting: {
      config: null,
      votes: {},   // { [photoKey]: [ { visitorId, name, avatar, qq, ts } ] }
      voters: {}   // { [visitorId]: { key, qq, ts } }
    },
    submissions: {
      config: null,
      items: [],   // [ { id, visitorId, name, avatar, qq, title, photos: [ { k, tn } ], ts } ]
      authors: {}  // { [visitorId]: { id, qq, ts } }
    }
  };
  if (raw && typeof raw === 'object') {
    if (raw.photos && typeof raw.photos === 'object') {
      for (const [k, v] of Object.entries(raw.photos)) {
        if (!v || typeof v !== 'object') continue;
        out.photos[k] = {
          likes: Array.isArray(v.likes) ? v.likes.filter(Boolean).slice(0, 5000) : [],
          comments: Array.isArray(v.comments)
            ? v.comments.filter(Boolean).slice(-MAX_COMMENTS_PER_PHOTO)
            : [],
        };
      }
    }
    if (raw.voting && typeof raw.voting === 'object') {
      if (raw.voting.config && typeof raw.voting.config === 'object') {
        out.voting.config = raw.voting.config;
      }
      if (raw.voting.votes && typeof raw.voting.votes === 'object') {
        for (const [k, arr] of Object.entries(raw.voting.votes)) {
          if (Array.isArray(arr)) out.voting.votes[k] = arr.filter(Boolean);
        }
      }
      if (raw.voting.voters && typeof raw.voting.voters === 'object') {
        out.voting.voters = Object.assign({}, raw.voting.voters);
      }
    }
    if (raw.submissions && typeof raw.submissions === 'object') {
      if (raw.submissions.config && typeof raw.submissions.config === 'object') {
        out.submissions.config = raw.submissions.config;
      }
      if (Array.isArray(raw.submissions.items)) {
        out.submissions.items = raw.submissions.items.filter(Boolean);
      }
      if (raw.submissions.authors && typeof raw.submissions.authors === 'object') {
        out.submissions.authors = Object.assign({}, raw.submissions.authors);
      }
    }
  }
  // 投票活动默认配置
  if (!out.voting.config) {
    out.voting.config = {
      enabled: true,
      title: '首届 Phototropic 最美光影瞬间评选',
      rules: '每位访客可选心动的照片投票。请在投票时附上你的真实联系 QQ,活动截止后站长将联系得票最高作品的投票者赠送精美摄影纪念画册！',
      deadline: '2026-11-15 23:59',
      reward: '摄影集纪念明信片',
      maxVotes: 1
    };
  } else {
    out.voting.config.maxVotes = Math.max(1, parseInt(out.voting.config.maxVotes, 10) || 1);
  }
  // 作品征集活动默认配置 (1~3 张作品投递)
  if (!out.submissions.config) {
    out.submissions.config = {
      enabled: true,
      title: '首届 Phototropic 摄影作品征集邀约',
      rules: '欢迎投稿 1~3 张你的原创摄影佳作！请在提交时附上联系 QQ，活动截止后站长将精选优秀作品在画廊专题展出，并联系作者送出精美纪念礼品！',
      deadline: '2026-11-30 23:59',
      reward: '精美摄影集一份 + 画廊专题署名展出',
      maxPhotos: 3
    };
  } else {
    out.submissions.config.maxPhotos = Math.min(3, Math.max(1, parseInt(out.submissions.config.maxPhotos, 10) || 3));
  }
  return out;
}

async function loadStore() {
  try {
    const text = await storageGet(DATA_KEY);
    store = normalize(text ? JSON.parse(text) : null);
    loadError = null;
    console.log(
      `[store] 已载入互动数据: ${Object.keys(store.photos).length} 张照片有记录` +
        ` (来源: ${useCos ? 'COS' : '本地文件'})`
    );
  } catch (e) {
    loadError = e.message;
    console.error('[store] 读取失败:', e.message);
    if (!loaded) store = { photos: {} };
  }
  loaded = true;
}

/* 串行写队列:避免并发写互相覆盖 */
function persist() {
  writeChain = writeChain
    .then(() => storagePut(DATA_KEY, JSON.stringify(store)))
    .catch((e) => {
      console.error('[store] 写入失败:', e.message);
    });
  return writeChain;
}

/* ─────────── 反滥用:按 IP 的简单滑动限流 ─────────── */
const hits = new Map();
function rateLimit(ip, bucket, max, windowMs) {
  const key = ip + '|' + bucket;
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return true;
}

/* ─────────── 工具 ─────────── */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const t = Buffer.concat(chunks).toString('utf8');
      if (!t) return resolve({});
      try {
        resolve(JSON.parse(t));
      } catch (e) {
        reject(new Error('请求格式错误'));
      }
    });
    req.on('error', reject);
  });
}

const clean = (s, max) =>
  String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);

/* 定长比较,避免用 === 比较密钥时泄露长度/前缀信息 */
function safeEqual(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress ||
  'unknown';

function normalizeVisitor(v) {
  if (!v || typeof v !== 'object') return null;
  const id = clean(v.id, 64);
  if (!id) return null;
  return {
    id,
    name: clean(v.name, MAX_NAME) || '匿名的追光者',
    avatar: clean(v.avatar, 24) || 'a1',
  };
}

/* ─────────── 静态文件托管 ─────────── */
function serveIndex(res) {
  fs.readFile(path.join(__dirname, 'index.html'), (err, buf) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('index.html 读取失败:' + err.message);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

/* ─────────── 路由 ─────────── */
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const ip = clientIp(req);

  if (p === '/api/health') {
    return json(res, 200, {
      ok: true,
      loaded,
      storage: useCos ? 'cos' : 'local',
      cosConfigured: useCos,
      loadError,
      photos: Object.keys(store.photos).length,
    });
  }

  if (p === '/api/interactions' && req.method === 'GET') {
    if (!loaded) await loadStore();
    return json(res, 200, store);
  }

  if (p === '/api/like' && req.method === 'POST') {
    if (!rateLimit(ip, 'like', 120, 60 * 1000))
      return json(res, 429, { error: '操作太频繁,请稍后再试' });

    const body = await readBody(req);
    const key = clean(body.key, 512);
    const visitor = normalizeVisitor(body.visitor);
    if (!key) return json(res, 400, { error: '缺少照片标识' });
    if (!visitor) return json(res, 400, { error: '身份信息无效' });

    if (!loaded) await loadStore();
    const rec = store.photos[key] || (store.photos[key] = EMPTY());
    const i = rec.likes.findIndex((l) => l && l.id === visitor.id);
    let liked;
    if (i > -1) {
      rec.likes.splice(i, 1);
      liked = false;
    } else {
      rec.likes.push({
        id: visitor.id,
        name: visitor.name,
        avatar: visitor.avatar,
        ts: Date.now(),
      });
      liked = true;
    }
    await persist();
    return json(res, 200, { liked, count: rec.likes.length, key });
  }

  if (p === '/api/comment' && req.method === 'POST') {
    if (!rateLimit(ip, 'comment', 20, 60 * 1000))
      return json(res, 429, { error: '评论太频繁,请稍后再试' });

    const body = await readBody(req);
    const key = clean(body.key, 512);
    const visitor = normalizeVisitor(body.visitor);
    const text = clean(body.text, MAX_COMMENT);
    if (!key) return json(res, 400, { error: '缺少照片标识' });
    if (!visitor) return json(res, 400, { error: '身份信息无效' });
    if (!text) return json(res, 400, { error: '评论内容不能为空' });

    if (!loaded) await loadStore();
    const rec = store.photos[key] || (store.photos[key] = EMPTY());
    const item = {
      id: 'c_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex'),
      visitorId: visitor.id,
      name: visitor.name,
      avatar: visitor.avatar,
      text,
      ts: Date.now(),
    };
    rec.comments.push(item);
    if (rec.comments.length > MAX_COMMENTS_PER_PHOTO)
      rec.comments = rec.comments.slice(-MAX_COMMENTS_PER_PHOTO);
    await persist();
    return json(res, 201, { comment: item, count: rec.comments.length });
  }

  /* 删除评论:本人可删自己的(凭 visitor.id),站主凭 ADMIN_TOKEN 可删任意一条 */
  if (p === '/api/comment/delete' && req.method === 'POST') {
    if (!rateLimit(ip, 'cdelete', 60, 60 * 1000))
      return json(res, 429, { error: '操作太频繁' });

    const body = await readBody(req);
    const key = clean(body.key, 512);
    const id = clean(body.id, 64);
    if (!key || !id) return json(res, 400, { error: '参数不完整' });
    if (!loaded) await loadStore();

    const rec = store.photos[key];
    if (!rec) return json(res, 200, { ok: true });

    const target = rec.comments.find((c) => c && c.id === id);
    if (!target) return json(res, 200, { ok: true });

    const adminToken = process.env.ADMIN_TOKEN || '';
    const tokenOk = adminToken && clean(body.token, 200) === adminToken;
    const me = normalizeVisitor(body.visitor);
    const ownerOk = me && target.visitorId === me.id;

    if (!tokenOk && !ownerOk) return json(res, 403, { error: '只能删除自己的评论' });

    rec.comments = rec.comments.filter((c) => c && c.id !== id);
    await persist();
    return json(res, 200, { ok: true });
  }

  /**
   * 代删云端文件(供站长面板的"删除照片/替换照片/删除整组"使用)。
   * 鉴权:校验请求里带来的 COS 密钥是否与服务器上的一致 —— 站长在浏览器里
   * 保存过这对密钥(上传照片时就在用),所以删除时无需任何额外输入。
   * 为什么由后端删:见 cosDelete 的注释(浏览器跨域 DELETE 会被 COS CORS 拦截)。
   */
  if (p === '/api/photo/delete' && req.method === 'POST') {
    if (!rateLimit(ip, 'photoDel', 120, 60 * 1000))
      return json(res, 429, { error: '操作太频繁,请稍后再试' });

    const body = await readBody(req);

    /*
     * 鉴权:沿用上传所用的那对 COS 密钥。
     * 浏览器里已保存这对密钥(上传照片时就在用),删除时一并发来,
     * 后端校验它与服务器上的密钥一致即放行 —— 站长无需额外设置或输入任何口令,
     * 体验与上传完全一致;而外部访客拿不到密钥,也就删不了文件。
     */
    const sid = clean(body.sid, 128);
    const skey = clean(body.skey, 128);
    if (useCos && (!sid || !skey || !safeEqual(sid, COS_SECRET_ID) || !safeEqual(skey, COS_SECRET_KEY))) {
      return json(res, 403, {
        error: '密钥校验未通过',
        hint: '请先在「站点设置」里保存 COS 密钥(与上传照片用的是同一对)。',
      });
    }

    // 支持单个或多个 key
    const keys = (Array.isArray(body.keys) ? body.keys : [body.key])
      .map((k) => clean(k, 512))
      .filter(Boolean)
      .slice(0, 200);
    if (!keys.length) return json(res, 400, { error: '缺少要删除的文件标识' });

    const results = [];
    for (const k of keys) {
      try {
        await storageDelete(k);
        results.push({ key: k, ok: true });
      } catch (e) {
        console.error('[photo/delete] 失败:', k, e.message);
        results.push({ key: k, ok: false, error: e.message });
      }
    }
    const failed = results.filter((r) => !r.ok);
    return json(res, failed.length && failed.length === results.length ? 500 : 200, {
      ok: failed.length === 0,
      deleted: results.filter((r) => r.ok).length,
      failed: failed.length,
      results,
    });
  }

  /* ─────────── 投票活动相关 API ─────────── */

  // 1. 公开:读取活动配置与截止状态
  if (p === '/api/vote/config' && req.method === 'GET') {
    if (!loaded) await loadStore();
    const cfg = store.voting.config || {};
    const now = Date.now();
    let isExpired = false;
    if (cfg.deadline) {
      const dTime = new Date(cfg.deadline.replace(/-/g, '/')).getTime();
      if (!isNaN(dTime) && now > dTime) isExpired = true;
    }
    const vid = clean(url.searchParams.get('vid'), 64);
    let userVoted = false;
    let votedKeys = [];
    if (vid && store.voting.voters && store.voting.voters[vid]) {
      userVoted = true;
      const vr = store.voting.voters[vid];
      votedKeys = Array.isArray(vr.keys) ? vr.keys : (vr.key ? [vr.key] : []);
    }
    return json(res, 200, {
      enabled: Boolean(cfg.enabled) && !isExpired,
      rawEnabled: Boolean(cfg.enabled),
      isExpired,
      title: cfg.title || '最美光影评选',
      rules: cfg.rules || '',
      deadline: cfg.deadline || '',
      reward: cfg.reward || '',
      maxVotes: Math.max(1, parseInt(cfg.maxVotes, 10) || 1),
      userVoted,
      votedKeys,
      votedKey: votedKeys[0] || null
    });
  }

  // 2. 公开:提交投票 (支持站长指定可选张数, 校验 QQ 号, 防止刷票)
  if (p === '/api/vote/submit' && req.method === 'POST') {
    if (!rateLimit(ip, 'voteSub', 15, 60 * 1000))
      return json(res, 429, { error: '操作太频繁,请稍后再试' });

    const body = await readBody(req);
    const rawKeys = Array.isArray(body.keys) ? body.keys : (body.key ? [body.key] : []);
    const keys = [...new Set(rawKeys.map(k => clean(k, 512)).filter(Boolean))];
    const visitor = normalizeVisitor(body.visitor);
    const qq = clean(body.qq, 20);

    if (!loaded) await loadStore();
    const cfg = store.voting.config || {};
    const maxVotes = Math.max(1, parseInt(cfg.maxVotes, 10) || 1);
    const now = Date.now();
    let isExpired = false;
    if (cfg.deadline) {
      const dTime = new Date(cfg.deadline.replace(/-/g, '/')).getTime();
      if (!isNaN(dTime) && now > dTime) isExpired = true;
    }
    if (!cfg.enabled || isExpired) {
      return json(res, 400, { error: '本次投票活动已结束或暂未开启' });
    }
    if (!keys.length) return json(res, 400, { error: '请先挑选心仪的照片' });
    if (keys.length > maxVotes) {
      return json(res, 400, { error: `每位访客最多只能选择 ${maxVotes} 张照片` });
    }
    if (!visitor) return json(res, 400, { error: '访客身份无效' });

    // 校验 QQ 号: 必须是 5~13 位纯数字
    if (!qq || !/^\d{5,13}$/.test(qq)) {
      return json(res, 400, { error: '请输入有效的联系 QQ 号(5-13位数字),方便站长发放纪念礼' });
    }

    // 防刷票: 检查该 visitorId 是否已投过
    if (store.voting.voters && store.voting.voters[visitor.id]) {
      const vr = store.voting.voters[visitor.id];
      const vk = Array.isArray(vr.keys) ? vr.keys : (vr.key ? [vr.key] : []);
      return json(res, 400, {
        error: '你已经投过票了,每位访客限参与一次',
        votedKeys: vk,
        votedKey: vk[0] || null
      });
    }

    // 防刷票: 检查该 QQ 号是否已被使用
    const qqUsed = Object.values(store.voting.voters || {}).some(v => v && v.qq === qq);
    if (qqUsed) {
      return json(res, 400, { error: '该 QQ 号已参与过本次投票,不可重复使用' });
    }

    // 入库记录 (所选照片分别增加得票)
    const voteRecord = {
      visitorId: visitor.id,
      name: visitor.name,
      avatar: visitor.avatar,
      qq,
      ts: now
    };
    keys.forEach(k => {
      if (!store.voting.votes[k]) store.voting.votes[k] = [];
      store.voting.votes[k].push(voteRecord);
    });
    store.voting.voters[visitor.id] = { keys, key: keys[0], qq, ts: now };

    await persist();
    return json(res, 200, {
      ok: true,
      message: '投票成功！感谢你的参与',
      votedKeys: keys,
      votedKey: keys[0],
      count: keys.length
    });
  }

  // 3. 站长:保存修改活动配置
  if (p === '/api/vote/admin/config' && req.method === 'POST') {
    const body = await readBody(req);
    const sid = clean(body.sid, 128);
    const skey = clean(body.skey, 128);
    if (useCos && (!sid || !skey || !safeEqual(sid, COS_SECRET_ID) || !safeEqual(skey, COS_SECRET_KEY))) {
      return json(res, 403, { error: '密钥校验未通过' });
    }
    if (!loaded) await loadStore();
    const c = body.config || {};
    store.voting.config = {
      enabled: Boolean(c.enabled),
      title: clean(c.title, 64) || '光影摄影评选',
      rules: clean(c.rules, 500) || '',
      deadline: clean(c.deadline, 32) || '',
      reward: clean(c.reward, 100) || '',
      maxVotes: Math.max(1, parseInt(c.maxVotes, 10) || 1)
    };
    await persist();
    return json(res, 200, { ok: true, config: store.voting.config });
  }

  // 4. 站长:获取每张照片的得票明细与名单 (谁投的票, QQ 号是多少)
  if (p === '/api/vote/admin/results' && req.method === 'POST') {
    const body = await readBody(req);
    const sid = clean(body.sid, 128);
    const skey = clean(body.skey, 128);
    if (useCos && (!sid || !skey || !safeEqual(sid, COS_SECRET_ID) || !safeEqual(skey, COS_SECRET_KEY))) {
      return json(res, 403, { error: '密钥校验未通过' });
    }
    if (!loaded) await loadStore();

    // 聚合得票排行
    const ranking = [];
    let totalVotes = 0;
    const votesMap = store.voting.votes || {};
    for (const [k, arr] of Object.entries(votesMap)) {
      if (!Array.isArray(arr) || !arr.length) continue;
      totalVotes += arr.length;
      ranking.push({
        key: k,
        count: arr.length,
        voters: arr.map(v => ({
          name: v.name,
          avatar: v.avatar,
          qq: v.qq,
          ts: v.ts
        }))
      });
    }
    ranking.sort((a, b) => b.count - a.count);

    return json(res, 200, {
      ok: true,
      totalVotes,
      voterCount: Object.keys(store.voting.voters || {}).length,
      ranking,
      config: store.voting.config
    });
  }

  /* ─────────── 作品征集活动相关 API (Submissions) ─────────── */

  // 1. 公开:读取征集活动配置与访客投稿状态
  if (p === '/api/submission/config' && req.method === 'GET') {
    if (!loaded) await loadStore();
    const cfg = store.submissions.config || {};
    const now = Date.now();
    let isExpired = false;
    if (cfg.deadline) {
      const dTime = new Date(cfg.deadline.replace(/-/g, '/')).getTime();
      if (!isNaN(dTime) && now > dTime) isExpired = true;
    }
    const vid = clean(url.searchParams.get('vid'), 64);
    let userSubmitted = false;
    let submittedItem = null;
    if (vid && store.submissions.authors && store.submissions.authors[vid]) {
      userSubmitted = true;
      const subId = store.submissions.authors[vid].id;
      submittedItem = (store.submissions.items || []).find(it => it.id === subId) || null;
    }
    return json(res, 200, {
      enabled: Boolean(cfg.enabled) && !isExpired,
      rawEnabled: Boolean(cfg.enabled),
      isExpired,
      title: cfg.title || '摄影作品征集邀约',
      rules: cfg.rules || '',
      deadline: cfg.deadline || '',
      reward: cfg.reward || '',
      maxPhotos: Math.min(3, Math.max(1, parseInt(cfg.maxPhotos, 10) || 3)),
      userSubmitted,
      submittedItem
    });
  }

  // 2. 公开:访客上传 1~3 张摄影作品投稿 (带 QQ 号与防刷)
  if (p === '/api/submission/submit' && req.method === 'POST') {
    if (!rateLimit(ip, 'subSubmit', 8, 60 * 1000))
      return json(res, 429, { error: '投稿太频繁,请稍后再试' });

    // 作品图片经 base64 上传, 放宽请求体上限为 16MB
    const body = await readBody(req, 16 * 1024 * 1024);
    const visitor = normalizeVisitor(body.visitor);
    const qq = clean(body.qq, 20);
    const title = clean(body.title, 40) || '原创摄影作品';
    const photosRaw = Array.isArray(body.photos) ? body.photos : [];

    if (!loaded) await loadStore();
    const cfg = store.submissions.config || {};
    const maxPhotos = Math.min(3, Math.max(1, parseInt(cfg.maxPhotos, 10) || 3));
    const now = Date.now();
    let isExpired = false;
    if (cfg.deadline) {
      const dTime = new Date(cfg.deadline.replace(/-/g, '/')).getTime();
      if (!isNaN(dTime) && now > dTime) isExpired = true;
    }
    if (!cfg.enabled || isExpired) {
      return json(res, 400, { error: '本次作品征集活动已结束或暂未开启' });
    }
    if (!visitor) return json(res, 400, { error: '访客身份无效' });

    // 校验 QQ 号: 必须是 5~13 位纯数字
    if (!qq || !/^\d{5,13}$/.test(qq)) {
      return json(res, 400, { error: '请输入有效的联系 QQ 号(5-13位数字),方便站长联系发放纪念礼品' });
    }

    // 校验照片数量: 1 ~ maxPhotos (1~3张)
    if (!photosRaw.length) return json(res, 400, { error: '请至少选择 1 张照片进行投稿' });
    if (photosRaw.length > maxPhotos) {
      return json(res, 400, { error: `本次活动每次投稿最多可选 ${maxPhotos} 张照片` });
    }

    // 防刷: 检查 visitorId 是否已投过
    if (store.submissions.authors && store.submissions.authors[visitor.id]) {
      return json(res, 400, { error: '你已经参与过本次作品征集了,每位访客限投递一次' });
    }
    // 防刷: 检查该 QQ 号是否已被使用
    const qqUsed = Object.values(store.submissions.authors || {}).some(a => a && a.qq === qq);
    if (qqUsed) {
      return json(res, 400, { error: '该 QQ 号已参与过投稿,不可重复使用' });
    }

    // 处理并存储 1~3 张照片 (转为 Buffer 并上传至 COS 的 submissions/ 目录)
    const subId = 'sub_' + now.toString(36) + '_' + crypto.randomBytes(3).toString('hex');
    const yyyymm = new Date().toISOString().slice(0, 7).replace(/-/g, '');
    const savedPhotos = [];

    for (let i = 0; i < photosRaw.length; i++) {
      const pItem = photosRaw[i];
      if (!pItem || !pItem.data) continue;
      // 解析高清图
      const mainParsed = pItem.data.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (!mainParsed) continue;
      const ext = mainParsed[1].toLowerCase() === 'jpeg' ? 'jpg' : mainParsed[1].toLowerCase();
      const mainBuf = Buffer.from(mainParsed[2], 'base64');
      const mainKey = `submissions/${yyyymm}/${subId}_${i + 1}.${ext}`;

      // 解析缩略图 (若前端已生成 480px 小图)
      let tnKey = null;
      if (pItem.tn) {
        const tnParsed = pItem.tn.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (tnParsed) {
          const tnExt = tnParsed[1].toLowerCase() === 'jpeg' ? 'jpg' : tnParsed[1].toLowerCase();
          const tnBuf = Buffer.from(tnParsed[2], 'base64');
          tnKey = `submissions/${yyyymm}/${subId}_${i + 1}_t480.${tnExt}`;
          await storagePutBuffer(tnKey, tnBuf, 'image/' + tnExt);
        }
      }

      await storagePutBuffer(mainKey, mainBuf, 'image/' + ext);
      savedPhotos.push({
        k: mainKey,
        tn: tnKey || mainKey,
        title: clean(pItem.title, 40) || `作品 ${String(i + 1).padStart(2, '0')}`
      });
    }

    if (!savedPhotos.length) {
      return json(res, 400, { error: '照片文件格式无效或解析失败' });
    }

    const submissionRecord = {
      id: subId,
      visitorId: visitor.id,
      name: visitor.name,
      avatar: visitor.avatar,
      qq,
      title,
      photos: savedPhotos,
      ts: now
    };

    if (!Array.isArray(store.submissions.items)) store.submissions.items = [];
    store.submissions.items.unshift(submissionRecord);
    store.submissions.authors[visitor.id] = { id: subId, qq, ts: now };

    await persist();
    return json(res, 200, {
      ok: true,
      message: '作品投稿成功！感谢你的创作与分享',
      item: submissionRecord
    });
  }

  // 3. 站长:保存修改征集活动配置
  if (p === '/api/submission/admin/config' && req.method === 'POST') {
    const body = await readBody(req);
    const sid = clean(body.sid, 128);
    const skey = clean(body.skey, 128);
    if (useCos && (!sid || !skey || !safeEqual(sid, COS_SECRET_ID) || !safeEqual(skey, COS_SECRET_KEY))) {
      return json(res, 403, { error: '密钥校验未通过' });
    }
    if (!loaded) await loadStore();
    const c = body.config || {};
    store.submissions.config = {
      enabled: Boolean(c.enabled),
      title: clean(c.title, 64) || '摄影作品征集邀约',
      rules: clean(c.rules, 500) || '',
      deadline: clean(c.deadline, 32) || '',
      reward: clean(c.reward, 100) || '',
      maxPhotos: Math.min(3, Math.max(1, parseInt(c.maxPhotos, 10) || 3))
    };
    await persist();
    return json(res, 200, { ok: true, config: store.submissions.config });
  }

  // 4. 站长:获取所有征集作品明细与投稿人 QQ 清单
  if (p === '/api/submission/admin/list' && req.method === 'POST') {
    const body = await readBody(req);
    const sid = clean(body.sid, 128);
    const skey = clean(body.skey, 128);
    if (useCos && (!sid || !skey || !safeEqual(sid, COS_SECRET_ID) || !safeEqual(skey, COS_SECRET_KEY))) {
      return json(res, 403, { error: '密钥校验未通过' });
    }
    if (!loaded) await loadStore();

    const items = store.submissions.items || [];
    const totalPhotos = items.reduce((s, it) => s + (it.photos || []).length, 0);

    return json(res, 200, {
      ok: true,
      totalCount: items.length,
      totalPhotos,
      authorCount: Object.keys(store.submissions.authors || {}).length,
      items,
      config: store.submissions.config
    });
  }

  // 本地模式下读取投稿图片
  if (p.startsWith('/submissions/') || p.startsWith('/data/submissions/')) {
    const cleanRel = p.replace(/^\/data\//, '').replace(/^\//, '');
    const fp = path.join(__dirname, 'data', cleanRel);
    if (fs.existsSync(fp)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
      return fs.createReadStream(fp).pipe(res);
    }
  }

  if (p === '/' || p === '/index.html') {
    if (!loaded) loadStore().catch(() => {});
    return serveIndex(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('未找到');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('[error]', req.method, req.url, e.message);
    if (!res.headersSent) json(res, 500, { error: e.message || '服务器错误' });
  });
});

server.listen(PORT, () => {
  console.log(`Phototropic 已启动 · 端口 ${PORT}`);
  console.log(`数据存储: ${useCos ? `COS ${COS_BUCKET} (${COS_REGION})` : '本地文件(未配置 COS 密钥)'}`);
  loadStore().catch(() => {});
});
