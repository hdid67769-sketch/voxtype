# VoxType 发版更新 — 四步操作手册

> 每次发布新版本时，按顺序执行以下四步即可。

---

## 第一步：修改版本号

编辑 `src-tauri/tauri.conf.json`，把 `version` 改为新版本号：

```bash
# 例如从 0.1.0 升到 0.1.1
# "version": "0.1.0"  →  "version": "0.1.1"
```

**同时检查 `package.json` 的 version 是否同步。**

---

## 第二步：构建 + 签名

在项目根目录执行：

```bash
# 构建（约 5-10 分钟）
TAURI_SIGNING_PRIVATE_KEY=$(cat src-tauri/updater.key) npx tauri build

# 签名（构建完成后自动生成 .sig 文件，这一步通常已自动完成）
# 如果 .sig 不存在，手动签名：
npx tauri signer sign \
  --private-key-path src-tauri/updater.key \
  --password 'voxtype2026' \
  src-tauri/target/release/bundle/macos/VoxType.app.tar.gz
```

产物位置：
- `src-tauri/target/release/bundle/macos/VoxType.app.tar.gz`（~836MB）
- `src-tauri/target/release/bundle/macos/VoxType.app.tar.gz.sig`（404B）

---

## 第三步：更新服务器 + 上传

### 3a. 上传更新包到服务器

```bash
chmod +x scripts/upload-update.sh
./scripts/upload-update.sh root@<你的服务器IP>
```

脚本会自动：创建远程目录 → scp 上传 tar.gz + sig → 设置权限。

### 3b. SSH 到服务器，更新版本接口

```bash
ssh root@<你的服务器IP>

# 编辑更新路由
cd /root/voxtype-server   # 或你的服务端目录
nano src/routes/update.ts
```

需要修改三处：

```typescript
// 1. 改 version
version: '0.1.1',           // ← 新版本号

// 2. 改 notes（更新日志）
notes: 'VoxType v0.1.1\n- 修复了 XXX\n- 新增了 YYY',

// 3. 改 signature（替换为新的签名内容）
signature: '粘贴新的 .sig 文件内容',
```

**获取新签名内容**（在本机执行）：
```bash
cat src-tauri/target/release/bundle/macos/VoxType.app.tar.gz.sig
```

复制输出的完整字符串，替换到 `update.ts` 的 `signature` 字段。

### 3c. 重新构建并重启服务端

```bash
# 在服务器上
cd /root/voxtype-server
npm run build
pm2 restart voxtype-server
```

---

## 第四步：验证

1. 打开 VoxType 客户端
2. 进入 **Settings → About** 页面
3. 点击 **「检查更新」**
4. 应出现更新提示，显示新版本号和更新日志
5. 确认下载安装正常

---

## 关键信息速查

| 项目 | 值 |
|------|-----|
| 签名密钥 | `src-tauri/updater.key` |
| 密钥密码 | `voxtype2026` |
| 公钥（已在 tauri.conf.json） | `dW50cnVzdGVkIGNvbW1lbnQ6...` |
| 更新接口 | `https://api.voxtype.net/api/update/{{target}}/{{arch}}/{{current_version}}` |
| 下载地址 | `https://api.voxtype.net/downloads/VoxType.app.tar.gz` |
| 上传脚本 | `scripts/upload-update.sh` |
| 服务器 Nginx 下载目录 | `/usr/share/nginx/html/downloads/` |
