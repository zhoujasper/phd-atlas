#!/bin/bash
# 立即修复PhD Atlas加载速度问题

echo "🔧 PhD Atlas 性能紧急修复"
echo "================================"
echo ""

cd "D:\windows\Downloads\PhD Application"

# 1. 清理所有缓存
echo "1️⃣ 清理所有缓存..."
rm -rf node_modules/.vite
rm -rf .vite
echo "   ✅ 缓存已清理"

# 2. 重新优化依赖
echo ""
echo "2️⃣ 重新构建依赖缓存..."
npm run dev &
SERVER_PID=$!

# 等待服务器启动并完成依赖预构建
echo "   等待Vite预构建完成..."
sleep 15

# 3. 停止服务器
kill $SERVER_PID 2>/dev/null

echo ""
echo "3️⃣ 现在重启服务器测试速度..."
echo ""
echo "访问: http://localhost:5173"
echo ""
echo "预期首次加载时间："
echo "  - 开发环境: 3-5秒"
echo "  - 后续刷新: <1秒"
echo ""
echo "如果仍然慢，请运行: npm run build && npm run preview"
echo "生产构建会将请求数减少到 ~50 个"
