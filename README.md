# Chai Associates Local Tools

本地运行的报价工具：**Vue 3 + 纯 PHP 8.4 + MySQL 8.4 + Docker Compose**。不依赖 Laravel、Electron 或 Node.js 后端，无登录、注册及用户隔离。Node.js 仅在 Docker 构建阶段编译前端。

## 启动

安装并启动 Docker Desktop，在项目根目录执行：

```sh
cp .env.example .env
```

编辑 `.env`，为 `DB_PASSWORD` 和 `DB_ROOT_PASSWORD` 设置不同的长随机密码。这是内部数据库凭据，不是应用登录账号。然后执行：

```sh
docker compose up -d --build
```

Windows PowerShell 可用 `Copy-Item .env.example .env` 创建配置。

打开 **http://localhost:8088**。默认仅绑定本机回环地址，MySQL 不向宿主机发布端口。要换端口，修改 `.env` 中的 `APP_PORT` 后重新运行上述命令。

首次启动只初始化四套默认模板：Loan Refinance、Loan Subsale、SPA Purchaser、SPA Vendor。报价列表为空，不导入旧 Laravel 或 Electron 的业务数据。后续启动不会重复初始化或覆盖已保存数据。

## 功能

- Quotations：列表、分类、新建、保存、编辑、删除，报价 PDF／Excel 下载。
- Loan Refinance：保留原有左右布局及实时 Proforma Preview，费用规则、SST、融资金额、费用行调整／隐藏／排序及自定义项目。
- Templates：模板目录、文档布局、分区／类别／费用编辑、公式模拟、版本创建／保存／激活／删除。已保存报价保留当时的模板和计算快照。
- Settings & Storage：手动备份、每日自动备份、备份历史、恢复前预览、安全备份、完整性检查。
- 不提供外部数据导入或整库导出；报价文件下载不受影响。

## 停止与更新

```sh
docker compose stop                  # 停止服务，保留数据
# 再次启动
docker compose up -d
# 拉取代码后重新构建更新
git pull
docker compose up -d --build
# 查看状态和日志
docker compose ps
docker compose logs --tail 100 web backup
```

更新前可在 Settings & Storage 创建备份。数据库存于 `chai-php-tools_mysql-data` 卷，备份存于 `chai-php-tools_backups` 卷，均不打进镜像或提交 Git。不要使用 `docker compose down -v`，该命令会删除这些数据卷。数据库已初始化后，不能只修改 `.env` 密码来更改数据库账号密码。

后台备份服务每 15 分钟检查一次：启用时每天（UTC）生成一份，保留最近 14 份自动备份；手动和恢复前的安全备份不自动删除。Docker 停止时不执行备份。恢复在事务中替换当前报价和模板，先保存当前数据的安全备份；失败回滚。恢复预览 30 分钟后或数据发生变化后失效，需要重新选择。备份是应用业务数据快照，不是整个 MySQL 实例的镜像。

## 开发与验证

PHP 业务代码位于 `server/src`，HTTP 入口为 `server/public/api.php`。使用 PDO 参数绑定、InnoDB 事务、修订号检查和跨 PHP 进程的数据库锁。API 只接受本机 Host 和同源的自定义请求，不启用跨域访问。

前端位于 `renderer`，`renderer/api.js` 调用 PHP API；`renderer/bridge.js` 适配原 Vue 页面。`renderer/legacy` 是保留的 Vue UI，不包含 Laravel 运行时。

```sh
# 仅前端构建（本机需要 Node.js 24）
npm ci
npm run build
# 计算测试（本机需要 PHP 8.4+ 和 Composer）
composer install --working-dir=server
npm test
```

Docker 环境可执行 `sh scripts/test-docker.sh` 运行完整测试（macOS/Linux 或 Windows Git Bash）。脚本创建独立的 `chai_test` 数据库，完成后删除；若该测试库已存在则拒绝覆盖。

`server/tests/run.php` 包含 20 组原版计算对照及规则边界测试。设置 `DB_NAME=chai_test` 后才会执行数据库集成测试，必须使用专用的空测试库；绝不能指向日常使用的数据库。集成测试覆盖持久化、过期编辑、模板版本、快照、PDF/XLSX、恢复回滚及备份保留。

原 Electron 版本保留在 Git 标签 `v1.0.0` 和 `backup/electron-v1.0.0` 分支，旧安装包仍在 GitHub Release 中；当前分支是 PHP 网页版，不需要购买桌面应用签名。
