#!/bin/bash
# ============================================================
# VoxType 更新包上传脚本
# 用法: ./scripts/upload-update.sh [服务器用户@地址]
# 示例: ./scripts/upload-update.sh root@123.45.67.89
# ============================================================

set -e

# 配置
REMOTE="${1}"
if [ -z "$REMOTE" ]; then
  echo "用法: $0 <用户@服务器地址>"
  echo "示例: $0 root@123.45.67.89"
  exit 1
fi

# 本地文件路径
BUNDLE_DIR="src-tauri/target/release/bundle/macos"
TAR_GZ="$BUNDLE_DIR/VoxType.app.tar.gz"
SIG="$BUNDLE_DIR/VoxType.app.tar.gz.sig"

# 检查文件是否存在
if [ ! -f "$TAR_GZ" ]; then
  echo "❌ 找不到更新包: $TAR_GZ"
  echo "请先运行构建: npx tauri build"
  exit 1
fi

if [ ! -f "$SIG" ]; then
  echo "❌ 找不到签名文件: $SIG"
  echo "请先签名: npx tauri signer sign --private-key-path src-tauri/updater.key --password 'voxtype2026' $TAR_GZ"
  exit 1
fi

# 显示文件信息
TAR_SIZE=$(du -h "$TAR_GZ" | cut -f1)
SIG_SIZE=$(du -h "$SIG" | cut -f1)
echo "📦 更新包: $TAR_GZ ($TAR_SIZE)"
echo "🔏 签名文件: $SIG ($SIG_SIZE)"
echo "🖥️  上传到: $REMOTE:/usr/share/nginx/html/downloads/"
echo ""

# 在远程服务器创建目录
echo "→ 创建远程目录..."
ssh "$REMOTE" "sudo mkdir -p /usr/share/nginx/html/downloads"

# 上传文件
echo "→ 上传更新包..."
scp "$TAR_GZ" "$REMOTE:/tmp/VoxType.app.tar.gz"
ssh "$REMOTE" "sudo mv /tmp/VoxType.app.tar.gz /usr/share/nginx/html/downloads/"

echo "→ 上传签名文件..."
scp "$SIG" "$REMOTE:/tmp/VoxType.app.tar.gz.sig"
ssh "$REMOTE" "sudo mv /tmp/VoxType.app.tar.gz.sig /usr/share/nginx/html/downloads/"

# 设置权限
echo "→ 设置文件权限..."
ssh "$REMOTE" "sudo chmod 644 /usr/share/nginx/html/downloads/VoxType.app.tar.gz /usr/share/nginx/html/downloads/VoxType.app.tar.gz.sig"

# 验证
echo "→ 验证上传..."
ssh "$REMOTE" "ls -lh /usr/share/nginx/html/downloads/"

echo ""
echo "✅ 上传完成!"
echo ""
echo "后续步骤:"
echo "  1. 在服务器重启 Node.js 服务: pm2 restart voxtype-server"
echo "  2. 客户端 About 页面点击「检查更新」测试"
echo ""
echo "后续发版流程:"
echo "  1. 修改 src-tauri/tauri.conf.json 中的 version"
echo "  2. TAURI_SIGNING_PRIVATE_KEY=\$(cat src-tauri/updater.key) npx tauri build"
echo "  3. npx tauri signer sign --private-key-path src-tauri/updater.key --password 'voxtype2026' <tar.gz>"
echo "  4. 更新服务器 routes/update.ts 中的 version、notes、signature"
echo "  5. 运行本脚本上传"
