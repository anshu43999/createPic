# createPic

`createPic` 是一个静态图片生成页面项目，前端页面通过浏览器直接请求图片生成接口，用于提交文生图、图生图任务并查看页面内任务队列。

项目使用 Nginx 托管静态文件，并提供 Docker / Docker Compose 部署方式。

## 功能说明

- 图片生成页面：`site/index.html`
- 页面逻辑：`site/app.js`
- 固定接口地址：`http://49.51.182.250:3000`
- 当前使用的接口：
  - `POST /v1/images/generations`
  - `POST /v1/images/edits`
- 不包含历史记录接口，页面不会请求 `/api/images/history`
- 不包含图片代理接口，页面不会请求 `/api/image-proxy`

## 目录结构

```text
createPic/
├── site/
│   ├── index.html
│   ├── app.js
│   ├── assets/
│   └── pages/
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
├── .dockerignore
├── .gitignore
└── README.md
```

## 本地或服务器启动

进入项目目录：

```bash
cd /opt/apps/createPic
```

构建并启动：

```bash
docker compose up -d --build
```

如果服务器使用旧版 Docker Compose：

```bash
docker-compose up -d --build
```

访问地址：

```text
http://服务器IP:8080
```

健康检查地址：

```text
http://服务器IP:8080/health
```

## 更新部署

服务器已绑定 Git 仓库后，后续更新执行：

```bash
cd /opt/apps/createPic
git pull --ff-only
docker compose up -d --build
```

## 端口说明

`docker-compose.yml` 当前配置：

```yaml
ports:
  - "8080:80"
```

含义是服务器访问 `8080` 端口，容器内部使用 Nginx 的 `80` 端口。

如需改成其他端口，例如 `8090`：

```yaml
ports:
  - "8090:80"
```

然后重新启动：

```bash
docker compose up -d --build
```

## 注意事项

- 这是纯静态前端项目，不包含后端服务。
- 图片生成接口需要由 `http://49.51.182.250:3000` 提供。
- 如果页面使用 HTTPS 部署，而接口仍是 HTTP，浏览器可能会因为 mixed content 拦截请求。
- 建议服务器上的文件以 Git 仓库为准，不要直接手动修改服务器文件。
