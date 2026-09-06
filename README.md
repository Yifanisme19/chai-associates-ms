# Chai Associates Desktop

个人使用的 Electron + SQLite 桌面应用。打开即用，无登录、注册或服务器依赖。本阶段仅支持本地磁盘；NAS 共享功能暂不实施。

## 启动

开发环境要求 Node.js 22.13+（建议 Node.js 24）及 npm：

```sh
cd chai-associates-desktop
npm ci
npm start
```

打包后的应用无需安装 Node.js、PHP、Laravel、PostgreSQL 或 Docker。

```sh
npm run pack   # 本机可运行的应用目录
npm run dist   # 本机平台安装包
npm test       # 计算、数据库、快照、模板及导出测试
```

macOS Apple Silicon 应用位于 `release/mac-arm64/Chai Associates.app`。当前本机包未经 Developer ID 签名；对外分发前应配置签名与公证。Windows/Linux 的打包配置已提供，但尚未在对应系统验证。

## 已实现

- **Quotations**：列表、分类、保存草稿、重新打开、编辑、删除，PDF / Excel 导出。
- **Loan Refinance**：原 Laravel Vue 页面、左侧输入、右侧实时 Proforma Preview，费用规则、SST、贷款和融资金额、费用行修改/隐藏/排序/添加。
- **Templates**：原模板目录及编辑界面、文档布局、类别/分区/费用编辑、结构化公式与模拟、版本创建/激活/删除。已保存报价保留模板和计算快照。
- **本地存储**：首次自动创建 SQLite；Settings & Storage 可备份、复制并切换路径、打开已有数据库。复制保留原文件，切换失败保留当前连接。备份使用 SQLite 在线备份 API，不直接复制活动中的 WAL 数据库文件。

默认 macOS 数据位置：

```
~/Library/Application Support/chai-associates-desktop/chai.sqlite
~/Library/Application Support/chai-associates-desktop/storage.json
```

数据库包含报价、模板和版本。没有账号表或密码。`storage.json` 保存数据库路径及自动备份设置。Windows 使用当前用户的 AppData 下同名目录，Linux 使用应用配置目录。

**备份与导入**（Settings & Storage）：

- Create backup：创建完整 SQLite 备份，包含报价、模板版本、规则及计算快照；Save SQLite backup as 可另存到外部磁盘。
- 默认启用自动备份：应用运行时每天创建一次，每个数据库保留最近 14 份；手动备份及导入前的安全备份不会自动删除。备份历史可直接定位文件或恢复。
- Export data as JSON：导出可重新导入的完整数据文件。
- Import data / Restore backup：支持本应用 SQLite 备份及 JSON 导出，最大 100 MB。先验证文件并显示数量，再选择合并或恢复。PDF、Excel、Laravel/PostgreSQL 数据不是该导入格式。
- 合并：新增未冲突记录，跳过相同记录；ID、报价编号或模板版本冲突时保留当前记录，并在预览中列出冲突。
- 恢复：创建并切换到恢复后的新 SQLite 文件，保留原数据库。合并与恢复前均自动创建安全备份；写入使用事务，失败回滚。
- Check integrity：检查 SQLite 完整性及数据结构。Copy & switch 可复制数据库后切换本地路径。

备份默认位于用户数据目录的 `backups/`。同一硬盘上的备份不能防止硬盘损坏，建议定期使用另存备份保存到外部磁盘。

若原数据库被外部移动导致无法启动，先将文件移回已配置路径，或在应用关闭时修正 `storage.json`。不要直接编辑数据库或同时移动活动中的 `-wal` / `-shm` 文件。

## 与原 Laravel 项目的关系

本仓库仅包含 Electron 桌面端，旧 Laravel 源码已移出并独立归档。桌面端在 `renderer/legacy` 复制并使用原 Vue 页面和公共组件，`renderer/bridge.js` 将页面请求转接到 Electron IPC，不依赖 Inertia/Laravel 服务。

初始四套模板来自现有 `RuleSetSeeder` / `RuleCatalogSeeder`：Loan Refinance、Loan Subsale、SPA Purchaser、SPA Vendor。初始费率按项目种子规则保留，不代表对现行法律费率作了重新核定。现有 PostgreSQL 中的报价及后续自定义模板尚未导入桌面数据库。

`seed/templates.json` 已包含运行所需规则，`test/parity.json` 保留计算对照数据。构建、运行及测试均不需要 PHP 或旧 Laravel 源码。

## 实现与验证

- Electron 主进程负责文件、SQLite 和导出；隔离且沙箱化的界面仅访问有限 IPC，不提供任意 SQL 或文件读写接口。
- SQLite 使用 WAL、FULL 同步、事务及修订号检查，报价与模板更新不会静默覆盖过期编辑。
- 20 组原 Laravel 计算结果对照覆盖四种模板、五个金额边界；另有本地持久化、模板快照/版本、输入验证、备份恢复和 XLSX 读取验证。
- Electron 实测覆盖启动即用、自动计算 Preview、保存/重新打开、模板编辑、PDF/Excel 导出、备份及数据库复制切换。

## 无付费证书的安装包

```sh
npm run dist -- --mac --arm64 --x64 --publish never
npm run dist -- --win --x64 --publish never
```

安装包输出到 `release/`，文件名包含版本、系统与架构。Mac 使用免费的 ad-hoc 本地签名，不使用 Developer ID，不进行 Apple 公证；Windows 禁用证书签名但保留图标及版本信息。首次安装可能出现系统安全提示。GitHub Releases 为 private，仅有仓库访问权限的用户可下载。
