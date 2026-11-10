# FinLend Web 前端

 borrowers 端 + 管理端的前端实现，对应《详细设计报告》C16 WebRequestClient、C20 ApiRouter 前端侧、U01–U12 界面设计。

## 1. 环境要求

| 项 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | **≥ 22.12.0** | 已在 `v22.23.4` 上验证通过 |
| npm | ≥ 10 | 随 Node 22 附带 `v22.23.4` → npm 10.9.9 |
| 浏览器 | Edge / Chrome 最新版 | 已在 Edge 157 上验证；浏览器需支持 ES2020 |
| 操作系统 | Windows 10/11 | 路径与脚本按 Windows 编写 |

> 本工程使用 **Vite 8 + Vue 3.5 + Element Plus 2.14 + Pinia 2 + Vue Router 4**。
> 注意：Vite 8 的 `engines` 要求为 `^20.19.0 || >=22.12.0`，请勿使用 Node 18 及更早版本。

## 2. 安装与启动

```powershell
cd frontend

# 1) 安装依赖（安装后生成 package-lock.json，后续按锁文件安装）
npm install

# 2) 启动 Mock 后端（开发期没有真实后端时使用）
npm run mock          # 监听 http://127.0.0.1:8301

# 3) 另开一个终端，启动前端
npm run dev           # 访问 http://127.0.0.1:5173
```

### 2.1 npm 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器，`/api` 代理到 `VITE_API_TARGET`（默认 `http://127.0.0.1:8301`） |
| `npm run build` | 生产构建，产物在 `dist/` |
| `npm run preview` | 预览生产构建产物 |
| `npm run mock` | 启动内置 Mock API（`mock/server.js`） |
| `npm test` | 运行单元测试（Vitest） |

### 2.2 对接真实后端

后端就绪后，把代理目标改成后端地址即可，前端代码无需修改：

```powershell
$env:VITE_API_TARGET = 'http://127.0.0.1:8000'   # 后端实际地址
npm run dev
```

契约以《详细设计报告》5.3 接口清单为准：前缀 `/api/v1`，响应 `{code, message, data}`，成功 `code === 0`。

## 3. 演示账号（Mock 环境）

| 角色 | 账号 | 密码 | 说明 |
| --- | --- | --- | --- |
| 借款人（已实名） | `demo_user` | `demo1234` | 默认授信 50000.00，seed 余额 50000.00 |
| 借款人（未实名） | `newbie` | `newbie1234` | 用于验证「未实名不能申请」 |
| 管理员 | `admin` | `admin123` | 管理端入口 `/admin/login` |
| 演示验证码 | 固定 `888888` | — | 注册页验证码 |

## 4. 目录结构

```
frontend/
├── index.html
├── vite.config.js            # 端口、别名、/api 代理
├── vitest.config.js
├── package.json
├── mock/
│   └── server.js             # 开发期 Mock API（内存数据，重启重置）
├── scripts/
│   └── e2e-check.js          # 端到端流程验证脚本（交付证据来源）
└── src/
    ├── main.js               # 应用入口（Element Plus 中文语言包）
    ├── App.vue               # 按路由 meta.layout 选择布局
    ├── api/index.js          # A01–A10 接口封装
    ├── utils/
    │   ├── request.js        # C16 Axios 封装：401 续期、幂等键、错误映射
    │   ├── storage.js        # 令牌存储适配（access 内存 / refresh sessionStorage）
    │   ├── errors.js         # 业务码 → 中文提示
    │   ├── format.js         # 金额/费率/日期/脱敏/倒计时
    │   └── idempotency.js    # 幂等键生成与复用
    ├── stores/
    │   ├── session.js        # 会话与用户态
    │   └── message.js        # 未读数轮询
    ├── router/index.js       # 路由与守卫（用户端/管理端隔离）
    ├── layouts/
    │   ├── BorrowerLayout.vue
    │   └── AdminLayout.vue
    ├── components/
    │   ├── EmptyState.vue
    │   └── ErrorState.vue
    ├── styles/main.css
    └── views/
        ├── auth/             # U01 + 管理端登录
        ├── borrower/         # U02–U07
        └── admin/            # U09–U12
```

## 5. 验证方式

```powershell
# 单元测试：金额/费率/脱敏/日期/倒计时/幂等键
npm test

# 端到端流程（需先启动 npm run mock）
node scripts/e2e-check.js http://127.0.0.1:8301/api/v1
# 或走浏览器同一路径（需先启动 npm run dev）
node scripts/e2e-check.js http://127.0.0.1:5173/api/v1
```

当前验证结果见 [交付说明-联调验证记录.md](交付说明-联调验证记录.md)。

## 6. 安全说明（课程演示范围）

- access token **只存内存**，刷新凭证存 `sessionStorage`。该存储**不等同加密**，可被同源脚本读取，仅在课程演示环境使用；正式部署应改为 HttpOnly Cookie + CSRF 令牌，并同步后端契约。
- 页面展示的金额、利率、期次计划**全部来自后端**，前端不做金额计算。
- 金额与利率传输使用字符串，前端仅格式化展示。
- 上传仅接受 JPEG/PNG 且 ≤ 5 MiB，前端先做提示，服务端做最终校验。
