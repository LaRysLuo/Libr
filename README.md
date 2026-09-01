# Libr

Libr 是一个面向 Windows 10/11 与 macOS 12+ 的本地资源管理软件。图片、音视频、文档、元数据和预览都保存在一个可携带的 `.libr` 文件中。

## 当前实现

- Tauri 2 + React 19 + TypeScript + Rust，简体中文三栏桌面界面。
- 创建、打开、另存副本、双击文件关联和每库单写实例。
- 文件/文件夹批量导入、任务进度与取消、SHA-256 精确去重、增量 BLOB 写入。
- 文件夹、标签、智能文件夹、收藏、评分、颜色、备注、搜索、组合筛选、回收站、导出和外部只读打开。
- 可将指定文件夹（含子文件夹）临时分享到局域网；浏览器端支持预览、下载，以及可选的重命名、收藏和移到回收站操作。
- 图片缩略图与主色提取；其他类型使用格式化预览卡，原文件通过受限 `libr://` Range 协议读取。
- 完整性检查、在线备份和以新文件构建后原子替换的资源库压缩。
- Tauri Ed25519 应用内更新、跳过版本、24 小时检查节流、下载进度和活跃任务重启保护。
- GitHub Actions 生成 Windows x64 NSIS、macOS Universal DMG、签名更新包与 `latest.json`。

Office、PSD、AI、Sketch 等专有格式首版不做应用内解析，会显示类型预览并支持只读外部打开。首版也不包含账号、同步、协作、AI/OCR、近似图片搜索或密码加密。

## 本地开发

要求 Node.js 22 和 stable Rust。

```bash
npm ci
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- dev
```

只验证原生二进制而不生成安装包：

```bash
npm run tauri -- build --debug --no-bundle
```

## `.libr` 文件格式

`.libr` 是真实的单个 SQLite 应用文件，而不是改后缀的目录或 ZIP。数据库使用固定 `application_id`、版本化 `user_version`、外键、`synchronous=FULL` 与 `journal_mode=DELETE`。核心表包括：

`library_meta`、`blobs`、`assets`、`folders`、`asset_folders`、`tags`、`asset_tags`、`smart_folders`、`previews`、`trash` 和 FTS5 `asset_search`。

原始数据按 SHA-256 在 `blobs` 中唯一保存，`assets` 只引用数据记录。绝对路径仅作为来源信息，跨平台打开不依赖原路径。遇到高于当前应用支持的架构版本时，资源库以只读方式打开。

不要在资源库仍打开时通过网盘或移动硬盘同步；请先关闭资源库，再复制完整 `.libr` 文件。

局域网共享使用随机能力链接，不会暴露源文件路径，并始终排除加密文件夹的内容。共享只在 Libr 运行且资源库保持打开时有效；获得链接的局域网用户即拥有对应权限，因此应仅分享给可信任成员。

## 发布与应用内更新

更新端点为 `https://github.com/LaRysLuo/Libr/releases/latest/download/latest.json`。如果仓库位置变化，需要同步修改 `src-tauri/tauri.conf.json`。

本地已生成更新签名密钥：

- 公钥：`keys/libr-updater.key.pub`，内容已写入 Tauri 配置，可以提交。
- 私钥：`keys/libr-updater.key`，已被 `.gitignore` 排除，绝不能提交或丢失。

在仓库 Actions secrets 中配置：

- `TAURI_SIGNING_PRIVATE_KEY`：更新私钥完整内容。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：当前开发密钥为空；正式首发前建议换成带强密码的新密钥，并同步替换公钥。
- macOS Developer ID（可选）：`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`。未配置时使用 ad-hoc 签名且不公证，首次打开可能被 Gatekeeper 拦截。
- Windows Authenticode（可选）：`WINDOWS_CERTIFICATE`（PFX 的 Base64）和 `WINDOWS_CERTIFICATE_PASSWORD`。未配置时仍会发布 Tauri Ed25519 签名的更新包，但 SmartScreen 可能显示未知发布者警告。

将 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本保持一致，然后推送 `vX.Y.Z` 标签。发布流水线会：

1. 构建 macOS Universal DMG；配置 Apple 凭据时同时签名并公证。
2. 构建 Windows x64 NSIS；配置 PFX 时同时执行 Authenticode 签名。
3. 生成并上传 Tauri 更新包、`.sig` 和静态 `latest.json`。
4. 将 Universal macOS 更新映射为客户端使用的 `darwin-universal` 目标。

应用启动 10 秒后检查一次更新，随后最多每 24 小时自动检查；“资源库”菜单可手动检查。更新包通过配置中的 Ed25519 公钥强制验签。

## 代码结构

```text
src/                    React 界面、状态与 Tauri 调用
src-tauri/src/db.rs     SQLite 格式、导入、搜索和组织逻辑
src-tauri/src/protocol.rs 受限资源流协议与 Range 处理
src-tauri/src/commands.rs 公开 Tauri 命令与任务事件
.github/workflows/      CI 和双平台 Release 流水线
assets/                 原创扁平化 Libr 图标源文件
```
