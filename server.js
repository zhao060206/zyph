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
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const COS = require('cos-nodejs-sdk-v5');

/* ─────────── 配置 ─────────── */
const COS_BUCKET = process.env.COS_BUCKET || 'zhao-1465501838';
const COS_REGION = process.env.COS_REGION || 'ap-nanjing';
const COS_SECRET_ID = process.env.COS_SECRET_ID || '';
const COS_SECRET_KEY = process.env.COS_SECRET_KEY || '';
const DATA_KEY = process.env.DATA_KEY || 'interactions.json';
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

const MAX_NAME = 24;
const MAX_COMMENT = 500;
const MAX_COMMENTS_PER_PHOTO = 500;
const MAX_BODY = 64 * 1024;
const MAX_SUBMISSION_IMAGE_BYTES = 8 * 1024 * 1024;

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
        ACL: 'private',
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
const LOCAL_FILE = path.join(DATA_DIR, 'interactions.json');
const useCos = Boolean(COS_SECRET_ID && COS_SECRET_KEY);

function localGet() {
  try {
    return fs.readFileSync(LOCAL_FILE, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function localPut(text) {
  fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
  const tmp = `${LOCAL_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, LOCAL_FILE);
}

function localPutBuffer(key, buffer) {
  const p = dataPath(key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buffer);
}

const storageGet = (key) => (useCos ? cosGet(key) : Promise.resolve(localGet()));
const storagePut = (key, text) => (useCos ? cosPut(key, text) : Promise.resolve(localPut(text)));
const storagePutBuffer = (key, buffer, type) => (useCos ? cosPutBuffer(key, buffer, type) : Promise.resolve(localPutBuffer(key, buffer)));

/* 本地模式下也真正删除文件,避免管理面板显示已删除但磁盘仍保留。 */
const storageDelete = (key) => (useCos ? cosDelete(key) : Promise.resolve(localDelete(key)));

/* ─────────── 数据层:内存缓存 + 写穿透 ─────────── */
let store = {
  photos: {},
  voting: { config: null, votes: {}, voters: {} },
  submissions: { config: null, items: [], authors: {} },
};
let loaded = false;
let loadError = null;
let writeChain = Promise.resolve();
let lastPersisted = '';
let loadPromise = null;

const EMPTY = () => ({ likes: [], comments: [] });

function normalize(raw) {
  const out = {
    photos: Object.create(null),
    voting: {
      config: null,
      votes: Object.create(null),
      voters: Object.create(null)
    },
    submissions: {
      config: null,
      items: [],   // [ { id, visitorId, name, avatar, qq, title, photos: [ { k, tn } ], ts } ]
      authors: Object.create(null)
    },
    activityHistory: Array.isArray(raw && raw.activityHistory) ? raw.activityHistory : [],
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
        out.voting.voters = Object.assign(Object.create(null), raw.voting.voters);
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
        out.submissions.authors = Object.assign(Object.create(null), raw.submissions.authors);
      }
    }
  }
  // 投票活动默认配置
  if (!out.voting.config) {
    out.voting.config = {
      enabled: false,
      title: '摄影作品评选',
      rules: '选择喜欢的摄影作品，每位访客每期参与一次。联系 QQ 仅供站长联系使用。',
      deadline: '',
      reward: '',
      maxVotes: 1
    };
  } else {
    out.voting.config.maxVotes = Math.max(1, parseInt(out.voting.config.maxVotes, 10) || 1);
  }
  // 作品征集活动默认配置 (1~3 张作品投递)
  if (!out.submissions.config) {
    out.submissions.config = {
      enabled: false,
      title: '摄影作品征集',
      rules: '欢迎投递原创摄影作品，并留下联系 QQ 以便站长联系。每位访客每期参与一次。',
      deadline: '',
      reward: '',
      maxPhotos: 3
    };
  } else {
    out.submissions.config.maxPhotos = Math.min(3, Math.max(1, parseInt(out.submissions.config.maxPhotos, 10) || 3));
  }
  for (const type of ['voting', 'submissions']) {
    const cfg = out[type].config;
    const legacy = !['draft', 'published', 'ended'].includes(cfg.status);
    const existing = raw && raw[type] && raw[type].config;
    cfg.status = legacy ? (existing ? (cfg.enabled ? 'published' : 'ended') : 'draft') : cfg.status;
    cfg.eventId = cfg.eventId || `${type}_legacy`;
    cfg.enabled = cfg.status === 'published';
    if (type === 'voting') cfg.maxVotes = Math.min(20, Math.max(1, parseInt(cfg.maxVotes, 10) || 1));
    if (legacy && cfg.status === 'ended' && !out.activityHistory.some(item => item.id === cfg.eventId)) {
      const time = deadlineTime(cfg.deadline);
      cfg.endedAt = Number.isFinite(time) && time < Date.now() ? time : null;
      cfg.endReason = 'legacy';
      out.activityHistory.unshift({ id: cfg.eventId, type, ...JSON.parse(JSON.stringify(out[type])) });
    }
  }
  return out;
}

function loadStore() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const text = await storageGet(DATA_KEY);
      const raw = text ? JSON.parse(text) : null;
      if (text && (!raw || typeof raw !== 'object' || Array.isArray(raw))) throw new Error('互动数据结构无效');
      store = normalize(raw);
      lastPersisted = JSON.stringify(store);
      loadError = null;
      loaded = true;
      console.log(`[store] 已载入互动数据: ${Object.keys(store.photos).length} 张照片有记录`);
    } catch (e) {
      loadError = e.message;
      loaded = false;
      console.error('[store] 读取失败:', e.message);
      throw new HttpError(503, '互动数据暂时无法读取,请稍后重试');
    }
  })().finally(() => { loadPromise = null; });
  return loadPromise;
}

/* 整个写请求串行执行,包含查重、上传与持久化,避免投稿在上传等待期间重复通过查重。 */
async function persist() {
  const text = JSON.stringify(store);
  try {
    await storagePut(DATA_KEY, text);
    lastPersisted = text;
  } catch (e) {
    store = normalize(JSON.parse(lastPersisted));
    console.error('[store] 写入失败:', e.message);
    throw new HttpError(503, '数据未保存成功,请稍后重试');
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
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
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

const REQUEST_BODY = Symbol('parsed request body');
function readBody(req, limit = MAX_BODY) {
  if (req[REQUEST_BODY]) return Promise.resolve(req[REQUEST_BODY]);
  return new Promise((resolve, reject) => {
    if (req.destroyed) return reject(new HttpError(400, '请求连接已中断'));
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      if (tooLarge) return;
      size += c.length;
      if (size > limit) {
        tooLarge = true;
        reject(new HttpError(413, '请求体过大'));
        // 继续排空请求,让服务器能稳定返回 413,而不是直接重置连接。
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return;
      const t = Buffer.concat(chunks).toString('utf8');
      if (!t) return resolve({});
      try {
        const parsed = JSON.parse(t);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new HttpError(400, '请求体必须是 JSON 对象');
        }
        resolve(parsed);
      } catch (e) {
        reject(e instanceof HttpError ? e : new HttpError(400, '请求格式错误'));
      }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new HttpError(400, '请求连接已中断')));
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
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
  return {
    id,
    name: clean(v.name, MAX_NAME) || '匿名的追光者',
    avatar: clean(v.avatar, 24) || 'a1',
  };
}

function parseDataImage(value) {
  const m = String(value || '').match(
    /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i
  );
  if (!m) return null;
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length) return null;
  if (buffer.length > MAX_SUBMISSION_IMAGE_BYTES) {
    throw new HttpError(413, '单张投稿图片不能超过 8MB');
  }
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
  const signatureOk = {
    'image/jpeg': buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
    'image/png': buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/gif': /^(GIF87a|GIF89a)$/.test(buffer.subarray(0, 6).toString('ascii')),
    'image/webp': buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  }[mime];
  if (!signatureOk) return null;
  return { buffer, mime, ext };
}

function requireAdmin(body) {
  const token = process.env.ADMIN_TOKEN || '';
  if (token && safeEqual(body.token || '', token)) return;
  if (useCos && safeEqual(body.sid || '', COS_SECRET_ID) && safeEqual(body.skey || '', COS_SECRET_KEY)) return;
  if (!useCos && !token) throw new HttpError(503, '未配置管理员凭据');
  throw new HttpError(403, '密钥校验未通过');
}

// datetime-local 不含时区;活动统一按中国/新加坡时间解释,不依赖部署机时区。
function deadlineTime(value) {
  if (!value) return Infinity;
  const text = String(value).trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)) return NaN;
  const time = Date.parse(text + '+08:00');
  if (!Number.isFinite(time)) return NaN;
  const normalized = new Date(time + 8 * 3600000).toISOString().slice(0, text.length);
  return normalized === text ? time : NaN;
}

function eventExpired(config) {
  const time = deadlineTime(config.deadline);
  return Number.isNaN(time) || Date.now() >= time;
}

function publicInteractions(visitorId, keys = []) {
  const entries = keys.length ? [...new Set(keys)].slice(0, 50).map(key => [key, store.photos[key] || EMPTY()]) : Object.entries(store.photos);
  return { photos: Object.fromEntries(entries.map(([key, rec]) => [key, {
    likes: rec.likes.map(({ name, avatar, ts, id }) => ({ name, avatar, ts, mine: id === visitorId })),
    comments: rec.comments.map(({ id, name, avatar, text, ts, visitorId: owner }) =>
      ({ id, name, avatar, text, ts, mine: owner === visitorId })),
  }])) };
}

let galleryCache = null;
async function eligiblePhotoKeys() {
  if (galleryCache && Date.now() - galleryCache.loadedAt < 15000) return galleryCache.keys;
  let data;
  try {
    const local = path.join(DATA_DIR, 'gallery.json');
    if (!useCos && fs.existsSync(local)) data = JSON.parse(await fs.promises.readFile(local, 'utf8'));
    else {
      const response = await fetch(`https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/data.json`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('归档读取失败');
      data = await response.json();
    }
    if (!data || !Array.isArray(data.groups)) throw new Error('归档格式无效');
    const keys = new Set();
    for (const group of data.groups) for (const photo of group.gs || []) {
      if (photo.k) keys.add(photo.k);
      else if (photo.u) keys.add(`${group.d}#${photo.u}`);
    }
    galleryCache = { keys, loadedAt: Date.now() };
    return keys;
  } catch (error) {
    throw new HttpError(503, '作品目录暂时无法校验,请稍后再投票');
  }
}

function activitySummary(type, activity) {
  const config = activity.config || {};
  return {
    type, config,
    participants: type === 'voting' ? Object.keys(activity.voters || {}).length : Object.keys(activity.authors || {}).length,
    count: type === 'voting'
      ? Object.values(activity.votes || {}).reduce((sum, arr) => sum + arr.length, 0)
      : (activity.items || []).reduce((sum, item) => sum + (item.photos || []).length, 0),
  };
}

function endActivity(type, reason) {
  const activity = store[type];
  if (activity.config.status !== 'published') return false;
  activity.config = { ...activity.config, status: 'ended', enabled: false,
    endedAt: reason === 'deadline' ? deadlineTime(activity.config.deadline) : Date.now(), endReason: reason };
  if (!store.activityHistory.some(item => item.id === activity.config.eventId)) {
    store.activityHistory.unshift({
      id: activity.config.eventId, type,
      ...JSON.parse(JSON.stringify(activity)),
    });
  }
  return true;
}

function publicActivities() {
  return {
    current: ['voting', 'submissions'].map(type => activitySummary(type, store[type]))
      .filter(item => item.config.status !== 'draft'),
    history: store.activityHistory.map(item => activitySummary(item.type, item)),
  };
}

function updateActivityConfig(type, input) {
  const previous = store[type].config;
  const deadline = clean(input.deadline, 32);
  if (deadline && Number.isNaN(deadlineTime(deadline))) throw new HttpError(400, '截止时间无效');
  const config = {
    ...previous,
    title: clean(input.title, 64) || (type === 'voting' ? '摄影作品评选' : '摄影作品征集'),
    rules: clean(input.rules, 1000), deadline,
    reward: clean(input.reward, 100),
  };
  if (type === 'voting') config.maxVotes = Math.min(20, Math.max(1, parseInt(input.maxVotes, 10) || 1));
  else config.maxPhotos = Math.min(3, Math.max(1, parseInt(input.maxPhotos, 10) || 3));
  store[type].config = config;
  return config;
}

function manageActivity(type, action, input = {}) {
  if (!['voting', 'submissions'].includes(type)) throw new HttpError(400, '活动类型无效');
  const activity = store[type];
  if (action === 'new') {
    if (activity.config.status === 'published') throw new HttpError(409, '请先结束当前活动,再新建下一期');
    if (activity.config.status === 'draft') throw new HttpError(409, '当前已有草稿,请编辑或发布');
    const config = { ...activity.config, eventId: `${type}_${crypto.randomUUID()}`, status: 'draft', enabled: false,
      createdAt: Date.now(), publishedAt: null, endedAt: null, endReason: null, deadline: '' };
    store[type] = type === 'voting' ? { config, votes: Object.create(null), voters: Object.create(null) }
      : { config, items: [], authors: Object.create(null) };
  } else if (action === 'end') {
    if (!endActivity(type, 'manual')) throw new HttpError(409, '只有已发布的活动可以结束');
  } else if (action === 'save' || action === 'publish') {
    if (activity.config.status === 'ended') throw new HttpError(409, '活动已结束并留档,请新建下一期');
    const config = updateActivityConfig(type, input);
    if (action === 'publish') {
      if (config.status !== 'draft') throw new HttpError(409, '活动已经发布');
      if (eventExpired(config)) throw new HttpError(400, '截止时间必须晚于当前时间');
      config.eventId = `${type}_${crypto.randomUUID()}`;
      config.status = 'published';
      config.enabled = true;
      config.publishedAt = Date.now();
    } else if (config.status === 'published' && eventExpired(config)) {
      throw new HttpError(400, '截止时间必须晚于当前时间,提前结束请使用结束活动');
    }
  } else throw new HttpError(400, '活动操作无效');
}

/* ─────────── 静态文件托管 ─────────── */
function dataPath(key) {
  const root = path.resolve(DATA_DIR);
  const fp = path.resolve(root, String(key || '').replace(/^[/\\]+/, ''));
  if (fp !== root && !fp.startsWith(root + path.sep)) {
    throw new HttpError(400, '文件标识无效');
  }
  return fp;
}

function localDelete(key) {
  const fp = dataPath(key);
  if (path.resolve(fp) === path.resolve(LOCAL_FILE)) {
    throw new HttpError(400, '不能删除互动数据文件');
  }
  fs.rmSync(fp, { force: true });
  return { local: true };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  }[ext] || 'application/octet-stream';
}

const assetCache = new Map();
const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/assets/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/assets/site.css', ['public/site.css', 'text/css; charset=utf-8']],
  ...['spring', 'autumn'].flatMap(kind => [0,1,2].map(index => [`/assets/season/${kind}-${index}.webp`, [`public/season-assets/${kind}-${index}.webp`, 'image/webp']])),
  ['/assets/season/ATTRIBUTION.md', ['public/season-assets/ATTRIBUTION.md', 'text/markdown; charset=utf-8']],
  ['/assets/tone-index.json', ['public/tone-index.json', 'application/json; charset=utf-8']],
]);

async function serveAsset(req, res, filename, type) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '请求方法不支持' });
  const fp = path.join(__dirname, filename);
  const stat = await fs.promises.stat(fp);
  let cached = assetCache.get(filename);
  if (!cached || cached.mtime !== stat.mtimeMs) {
    const raw = await fs.promises.readFile(fp);
    const [gz, br] = await Promise.all([gzip(raw), brotliCompress(raw)]);
    cached = { mtime: stat.mtimeMs, raw, gzip: gz, br,
      hash: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24) };
    assetCache.set(filename, cached);
  }
  const encodings = String(req.headers['accept-encoding'] || '').split(',').map(part => {
    const [name, ...params] = part.trim().split(';');
    const quality = params.find(item => item.trim().startsWith('q='));
    return { name, q: quality ? Number(quality.trim().slice(2)) : 1 };
  }).filter(item => item.q > 0).sort((a, b) => b.q - a.q || (b.name === 'br' ? 1 : 0) - (a.name === 'br' ? 1 : 0));
  const encoding = encodings.find(item => item.name === 'br' || item.name === 'gzip');
  const name = encoding ? encoding.name : 'raw';
  const etag = `"${cached.hash}-${name}"`;
  const headers = {
    'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag, Vary: 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  if (name !== 'raw') headers['Content-Encoding'] = name;
  if (String(req.headers['if-none-match'] || '').split(',').some(item => item.trim().replace(/^W\//, '') === etag)) {
    res.writeHead(304, headers);
    return res.end();
  }
  const buf = cached[name];
  res.writeHead(200, { ...headers, 'Content-Length': buf.length });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

/* ─────────── 路由 ─────────── */
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const ip = clientIp(req);

  if (p === '/api/health') {
    return json(res, loaded && !loadError ? 200 : 503, {
      ok: loaded && !loadError,
      loaded,
      storage: useCos ? 'cos' : 'local',
      cosConfigured: useCos,
      loadError,
      photos: Object.keys(store.photos).length,
    });
  }

  if (p.startsWith('/api/') && !loaded) await loadStore();

  if (p.startsWith('/api/')) {
    let ended = false;
    for (const type of ['voting', 'submissions']) {
      if (store[type].config.status === 'published' && eventExpired(store[type].config)) {
        ended = endActivity(type, 'deadline') || ended;
      }
    }
    if (ended) await persist();
  }

  if (p === '/api/activities' && req.method === 'GET') return json(res, 200, publicActivities());

  if (p === '/api/activities/admin' && req.method === 'POST') {
    const body = await readBody(req);
    requireAdmin(body);
    if (body.action === 'history') {
      const record = store.activityHistory.find(item => item.id === body.id);
      if (!record) throw new HttpError(404, '活动记录不存在');
      return json(res, 200, { ok: true, record });
    }
    if (body.action && body.action !== 'list') {
      manageActivity(body.type, body.action, body.config);
      await persist();
    }
    return json(res, 200, { ok: true,
      current: ['voting', 'submissions'].map(type => activitySummary(type, store[type])),
      history: store.activityHistory.map(item => activitySummary(item.type, item)),
    });
  }

  if (p === '/api/interactions' && req.method === 'GET') {
    return json(res, 200, publicInteractions(clean(url.searchParams.get('vid'), 64), url.searchParams.getAll('key').map(key => clean(key, 512)).filter(Boolean)));
  }

  if (p === '/api/like' && req.method === 'POST') {
    if (!rateLimit(ip, 'like', 120, 60 * 1000))
      return json(res, 429, { error: '操作太频繁,请稍后再试' });

    const body = await readBody(req);
    const key = clean(body.key, 512);
    const visitor = normalizeVisitor(body.visitor);
    if (!key) return json(res, 400, { error: '缺少照片标识' });
    if (!visitor) return json(res, 400, { error: '身份信息无效' });

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

    const rec = store.photos[key];
    if (!rec) return json(res, 200, { ok: true });

    const target = rec.comments.find((c) => c && c.id === id);
    if (!target) return json(res, 200, { ok: true });

    const adminToken = process.env.ADMIN_TOKEN || '';
    const tokenOk = adminToken && safeEqual(clean(body.token, 200), adminToken);
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
    requireAdmin(body);

    // 支持单个或多个 key
    const keys = (Array.isArray(body.keys) ? body.keys : [body.key])
      .map((k) => clean(k, 512))
      .filter(Boolean);
    if (!keys.length) return json(res, 400, { error: '缺少要删除的文件标识' });
    if (keys.length > 200) throw new HttpError(400, '单次最多删除 200 个文件');
    if (keys.some(key => !/^(photos|submissions|music)\//.test(key) || key.includes('..') || key.includes('\\'))) {
      throw new HttpError(400, '只能删除照片、投稿或音乐文件');
    }

    const results = [];
    let cursor = 0;
    const worker = async () => {
    while (cursor < keys.length) {
      const k = keys[cursor++];
      try {
        await storageDelete(k);
        results.push({ key: k, ok: true });
      } catch (e) {
        console.error('[photo/delete] 失败:', k, e.message);
        results.push({ key: k, ok: false, error: e.message });
      }
    }
    };
    await Promise.all(Array.from({ length: Math.min(4, keys.length) }, worker));
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
    const cfg = store.voting.config || {};
    const now = Date.now();
    const isExpired = eventExpired(cfg);
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
      status: cfg.status, eventId: cfg.eventId, endedAt: cfg.endedAt || null,
      deadlineZone: '+08:00',
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

    const cfg = store.voting.config || {};
    const maxVotes = Math.max(1, parseInt(cfg.maxVotes, 10) || 1);
    if (body.eventId && body.eventId !== cfg.eventId) throw new HttpError(409, '活动已更新,请刷新后参与');
    const now = Date.now();
    const isExpired = eventExpired(cfg);
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

    const eligible = await eligiblePhotoKeys();
    if (keys.some(key => !eligible.has(key))) throw new HttpError(400, '所选作品不在当前归档中,请刷新后选择');

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
    requireAdmin(body);
    const c = body.config || {};
    const current = store.voting.config;
    if (c.enabled) manageActivity('voting', current.status === 'draft' ? 'publish' : 'save', c);
    else if (current.status === 'published') manageActivity('voting', 'end');
    else manageActivity('voting', 'save', c);
    await persist();
    return json(res, 200, { ok: true, config: store.voting.config });
  }

  // 4. 站长:获取每张照片的得票明细与名单 (谁投的票, QQ 号是多少)
  if (p === '/api/vote/admin/results' && req.method === 'POST') {
    const body = await readBody(req);
    requireAdmin(body);

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
    const cfg = store.submissions.config || {};
    const now = Date.now();
    const isExpired = eventExpired(cfg);
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
      status: cfg.status, eventId: cfg.eventId, endedAt: cfg.endedAt || null,
      deadlineZone: '+08:00',
      isExpired,
      title: cfg.title || '摄影作品征集邀约',
      rules: cfg.rules || '',
      deadline: cfg.deadline || '',
      reward: cfg.reward || '',
      maxPhotos: Math.min(3, Math.max(1, parseInt(cfg.maxPhotos, 10) || 3)),
      storage: useCos ? 'cos' : 'local',
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

    const cfg = store.submissions.config || {};
    const maxPhotos = Math.min(3, Math.max(1, parseInt(cfg.maxPhotos, 10) || 3));
    if (body.eventId && body.eventId !== cfg.eventId) throw new HttpError(409, '活动已更新,请刷新后参与');
    const now = Date.now();
    const isExpired = eventExpired(cfg);
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

    // 全部校验通过后再上传,不把一批坏文件中的前几张当成完整投稿提交。
    const parsedPhotos = photosRaw.map(item => {
      const main = item && parseDataImage(item.data);
      const thumbnail = item && item.tn ? parseDataImage(item.tn) : null;
      if (!main || (item.tn && !thumbnail)) throw new HttpError(400, '照片格式无效,请使用 JPEG、PNG、WebP 或 GIF');
      return { item, main, thumbnail };
    });

    // 处理并存储 1~3 张照片 (转为 Buffer 并上传至 COS 的 submissions/ 目录)
    const subId = 'sub_' + now.toString(36) + '_' + crypto.randomBytes(3).toString('hex');
    const yyyymm = new Date().toISOString().slice(0, 7).replace(/-/g, '');
    const savedPhotos = [];
    const uploadedKeys = [];

    try {
    for (let i = 0; i < parsedPhotos.length; i++) {
      const { item: pItem, main: mainParsed, thumbnail: tnParsed } = parsedPhotos[i];
      // 解析高清图
      const ext = mainParsed.ext;
      const mainBuf = mainParsed.buffer;
      const mainKey = `submissions/${yyyymm}/${subId}_${i + 1}.${ext}`;

      // 解析缩略图 (若前端已生成 480px 小图)
      let tnKey = null;
      if (tnParsed) {
          const tnExt = tnParsed.ext;
          const tnBuf = tnParsed.buffer;
          tnKey = `submissions/${yyyymm}/${subId}_${i + 1}_t480.${tnExt}`;
          uploadedKeys.push(tnKey);
          await storagePutBuffer(tnKey, tnBuf, tnParsed.mime);
      }

      uploadedKeys.push(mainKey);
      await storagePutBuffer(mainKey, mainBuf, mainParsed.mime);
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
    } catch (error) {
      const cleanup = await Promise.allSettled(uploadedKeys.map(key => storageDelete(key)));
      if (cleanup.some(item => item.status === 'rejected')) console.error('[submission] 部分临时图片清理失败');
      throw error;
    }
  }

  // 3. 站长:保存修改征集活动配置
  if (p === '/api/submission/admin/config' && req.method === 'POST') {
    const body = await readBody(req);
    requireAdmin(body);
    const c = body.config || {};
    const current = store.submissions.config;
    if (c.enabled) manageActivity('submissions', current.status === 'draft' ? 'publish' : 'save', c);
    else if (current.status === 'published') manageActivity('submissions', 'end');
    else manageActivity('submissions', 'save', c);
    await persist();
    return json(res, 200, { ok: true, config: store.submissions.config });
  }

  // 4. 站长:获取所有征集作品明细与投稿人 QQ 清单
  if (p === '/api/submission/admin/list' && req.method === 'POST') {
    const body = await readBody(req);
    requireAdmin(body);

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
    try {
      const fp = dataPath(cleanRel);
      if (fs.existsSync(fp)) {
        res.writeHead(200, {
          'Content-Type': contentTypeFor(fp),
          'Cache-Control': 'public, max-age=86400, immutable',
          'X-Content-Type-Options': 'nosniff',
        });
        return fs.createReadStream(fp).pipe(res);
      }
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    }
  }

  if (publicFiles.has(p)) return serveAsset(req, res, ...publicFiles.get(p));

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('未找到');
}

const server = http.createServer((req, res) => {
  const dispatch = async () => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; }
    catch (error) { throw new HttpError(400, '请求地址无效'); }
    const isApi = pathname.startsWith('/api/') && pathname !== '/api/health';
    // 接收请求体不占用存储事务队列,手机上传中断不会阻塞其他访客。
    if (isApi && req.method === 'POST') {
      req[REQUEST_BODY] = await readBody(req, pathname === '/api/submission/submit' ? 16 * 1024 * 1024 : MAX_BODY);
    }
    const run = async () => {
      if (req.destroyed && !req.complete) return;
      try { await handle(req, res); }
      catch (e) {
        if (isApi && lastPersisted) store = normalize(JSON.parse(lastPersisted));
        throw e;
      }
    };
    const task = isApi ? writeChain.then(run) : run();
    if (isApi) writeChain = task.catch(() => {});
    await task;
  };
  dispatch().catch((e) => {
    console.error('[error]', req.method, String(req.url).split('?')[0], e.message);
    if (!res.headersSent && !res.destroyed) {
      const status = e instanceof HttpError ? e.status : 500;
      json(res, status, { error: status < 500 || e instanceof HttpError ? e.message : '服务器暂时无法处理请求' });
    }
  });
});
server.requestTimeout = 60000;

if (require.main === module) server.listen(PORT, () => {
  console.log(`Phototropic 已启动 · 端口 ${PORT}`);
  console.log(`数据存储: ${useCos ? `COS ${COS_BUCKET} (${COS_REGION})` : '本地文件(未配置 COS 密钥)'}`);
  loadStore().catch(() => {});
});

module.exports = { server, loadStore };
