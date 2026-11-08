# Phototropic

摄影作品归档，包含相册、图片预览、点赞、留言、摄影评选和作品征集。

前端使用原生 JavaScript 和 CSS，无运行时框架、外部字体或自动播放视频。动效根据系统偏好、设备信息和短时帧表现自动分级，运行中出现持续卡顿会降低动效。

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
