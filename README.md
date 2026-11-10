# Phototropic

摄影作品归档，包含相册、图片预览、点赞、留言、摄影评选和作品征集。

前端使用原生 JavaScript 和 CSS，无运行时框架、外部字体或自动播放视频。动效根据系统偏好、设备信息和短时帧表现自动分级，运行中出现持续卡顿会降低动效。

四季主题默认按月份选择，访客可以手动切换并独立选择明暗主题。春季花瓣、夏季柔光、秋季枫叶和冬季雪花只在性能允许时运行，打开弹窗或隐藏页面时暂停。

作品区可切换“日期·地点”和“色调”。前者保留独立相册印样，后者按单张照片跨相册筛选；后台支持修正色调，新上传和替换的照片自动取色。

```sh
npm ci
npm start
```

默认访问 `http://localhost:3000`。后台入口是 `/#admin`，也可以快速点击标志五次。

修改前端源文件后执行 `npm run build`，并一同提交 `public/` 中的构建产物。部署配置、活动管理、数据存储和验证范围见[部署说明书](部署说明书.md)。

```sh
npm run check
npm run test:browser
```

跨引擎验收先安装 `npx playwright install firefox webkit`，再设置 `CROSS_BROWSER=1` 运行浏览器测试。Windows 默认使用本机 Edge；其他平台需要先安装 Playwright Chromium。

`npm run analyze:tones` 只读取公开目录和小预览，增量更新 `public/tone-index.json`，不会修改云端原图或目录。需要重新分析已有照片时运行 `npm run analyze:tones -- --refresh`。Windows 使用本机 Edge；其他平台先安装 Playwright Chromium。

本地服务启动后，可用 `PREVIEW_URL` 指定地址运行 `node scripts/preview-seasons.mjs` 获取四季截图，或运行 `node scripts/profile-seasons.mjs` 检查反复切换后的 JS 堆、监听器、绘图层与动画帧。两者默认访问 `http://localhost:3011`，结果写入忽略的 `qa-*` 文件，不代表手机真机或整个浏览器进程的内存。

本次界面设计参考 [unslop](https://github.com/heydamir/unslop)，由 [Damir Sokolovsky (@heydamir)](https://x.com/heydamir) 创建，CC BY 4.0。按 Phototropic 的四季摄影主题调整配色、圆角与交互，保留作者署名。
