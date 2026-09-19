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

const storageGet = (key) => (useCos ? cosGet(key) : Promise.resolve(localGet()));
const storagePut = (key, text) => (useCos ? cosPut(key, text) : Promise.resolve(localPut(text)));

/* 本地模式下的"删除":仅做存在性校验(本地只有 interactions.json 一个文件,不涉及图片) */
const storageDelete = (key) => (useCos ? cosDelete(key) : Promise.resolve({ local: true }));

/* ─────────── 数据层:内存缓存 + 写穿透 ─────────── */
let store = { photos: {} };
let loaded = false;
let loadError = null;
let writeChain = Promise.resolve();

const EMPTY = () => ({ likes: [], comments: [] });

function normalize(raw) {
  const out = { photos: {} };
  if (raw && typeof raw === 'object' && raw.photos && typeof raw.photos === 'object') {
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
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
    if (!sid || !skey || !safeEqual(sid, COS_SECRET_ID) || !safeEqual(skey, COS_SECRET_KEY)) {
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
