# 螺蛳湾海外供货平台

面向螺蛳湾商户和平台运营，按“商户入驻 → 标准 SKU 库 → 商户供货维护 → 自动匹配组货 → 对外报价”逐步建设。

一个标准 SKU 对应多个商户供货报价。商户维护供货价、可供量、起订量、数量倍数、交期及有效期；内部供货成本与客户售价分开管理。供货平台对商户免费，付费社群身份不影响供货资格或匹配排序。

## 当前交付 M1

本阶段实现商户与标准货盘基础，未实现自动数量分配及客户报价。

- 运营主动创建空白工作空间；没有预置商户或订单冒充真实业务。
- 商户凭邀请码申请入驻，登录账号绑定到自己的商户；运营审核或暂停。
- 运营可以协助登记、维护尚未绑定账号的商户。
- 标准 SKU 录入、商品身份校验、审核；同一 SKU 的公共资料不含商户价格和库存。
- 多家商户关联同一 SKU，各自维护供货价、可供量、起订量、数量倍数、交期和报价有效期。
- 首次供货关联审核；已审核关联更新价格与数量产生新版本；下架后再次提交须审核。
- 过期、未准入、未审核或可供数量不足的报价不会显示为有效供给。
- 服务端根据登录账号判断权限，不接受客户端角色声明；商户看不到其他商户报价。
- 操作记录、报价版本、并发冲突保护、桌面与手机界面。

完整计划：[开发路线图](docs/roadmap.md)。设计约束：[架构与数据说明](docs/architecture.md)。

## 本地运行

使用 Node.js 24 与 npm。在独立项目根目录执行：

```sh
npm ci
npm run build
```

首次使用一个新的本地数据库，分别执行两份迁移（只执行一次）：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_tough_shadow_king.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_outstanding_the_professor.sql
npm run dev -- --port 5178 --hostname 127.0.0.1
```

已有初始演示数据库时，只执行尚未应用的第二份迁移。旧表保持原样，M1 使用新的 `catalog_workspaces` 表，应用不读取旧演示数据。迁移再次执行会报告表已存在，不要为了重跑删除已有业务数据。

打开终端输出的本机地址，登录后建立运营空间。当前开发服务器的 Sites 本地登录固定为一个开发账号；浏览器可验证运营协助录入流程，多账号入驻和访问隔离通过真实 SQLite 接口测试验证。正式试用还需确定面向商户的登录方式和站点访问策略。

## 检查

```sh
npm run check
npm test
npm run build
npm run test:api
```

`test:api` 需要先启动本地服务；首次可创建一个明确标注的验证空间，并新增一个测试商户，不对外发送任何消息。其余检查不需要外部服务或密钥。

测试使用 Node 内置测试框架；接口测试通过 SQLite 执行与 D1 相同的查询，覆盖入驻、权限隔离、报价版本、并发冲突和过期规则。CI 已配置类型检查、测试与构建；尚未在 GitHub 远程执行。

## 项目结构

| 路径 | 用途 |
|---|---|
| `components/catalog/` | M1 界面与表单组件 |
| `lib/catalog/types.ts` | 标准 SKU、商户、供货报价和账号关系 |
| `lib/catalog/domain.ts` | 业务规则、服务端权限与可用性判断 |
| `lib/catalog/service.ts` | HTTP 应用服务、持久化与并发保护 |
| `app/api/catalog/route.ts` | 可信登录身份与数据库适配入口 |
| `db/` 与 `drizzle/` | 数据库结构及迁移 |
| `tests/` | 业务规则、SQLite 接口测试及本机冒烟验证 |
| `docs/` | 路线图、架构和 GitHub 维护说明 |
| `.github/` | CI、PR 模板与开发任务模板 |

## GitHub 维护

本目录已经是独立 Git 仓库。初始演示版保存在基线提交，当前在 `codex/catalog-foundation` 分支开发，尚未绑定远程仓库或推送。

你建立 GitHub 仓库后，可以绑定该仓库并推送基线及开发分支，再通过 PR 管理变更。步骤见 [GitHub 维护说明](docs/github.md)。生产数据、依赖、构建产物、环境文件、本地数据库和截图均不进入版本库。

## 当前限制

- 当前实现为 M1 开发里程碑，尚未上线。自动匹配和对外报价属于 M2、M3。
- 登录沿用 Sites/ChatGPT 身份入口，应用层已实现独立运营空间和商户归属。迁移至其他托管平台需要替换身份适配器；不能直接信任来自公网客户端的身份头。
- 商户自助申请会绑定账号；运营代录的商户暂未提供后续账号认领流程。准入与登录体验需用实际商户验证。
- 商品图片暂填 HTTPS 地址，文件上传、批量导入及审核材料附件尚未实现。
- 标准 SKU 审核后不修改商品身份；发生规格变化应新建 SKU。误关联的合并、重关联和历史迁移属于后续数据治理任务。
- 每个空间目前以一个带版本号的 JSON 聚合存入 D1，约 2 MB 保存上限，适合小范围验证；扩量前拆分表、分页和独立审计归档。
- 暂不做采购承诺、数量预占、外部支付、物流操作或任何自动消息发送。
