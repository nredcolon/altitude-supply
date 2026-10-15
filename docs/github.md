# GitHub 维护说明

当前代码位于独立目录 `overseas-supply`，该目录本身就是 Git 仓库。不要从上一级工作资料目录推送，以免把方案、品牌素材等无关文件带入代码库。

目标代码仓库：[nredcolon/altitude-supply](https://github.com/nredcolon/altitude-supply)。首次同步前已检查为空仓库。主分支为 `main`，开发分支为 `codex/catalog-foundation`，首次同步采用同一份通过本地检查的项目代码。

后续开发在 `codex/` 前缀分支提交，通过 PR 合入 `main`。常规同步：

```sh
git fetch origin
git push -u origin codex/catalog-foundation
```

目标仓库如有新增提交，应先读取和协调历史，不要强推。CI 执行类型检查、业务与接口测试、生产构建，不自动部署。

建议按 `M1 商户与标准货盘`、`B1 海外选品询价`、`M2 自动匹配组货`、`M3 对外报价` 建立里程碑，每个 Issue 写明业务场景与验收。仓库包含相应的 Issue 和 PR 模板。

CI 使用官方 [checkout](https://github.com/actions/checkout) 与 [setup-node](https://github.com/actions/setup-node) 的工作流接口，Node 版本由 `.nvmrc` 统一维护。当前仅在本地完成同类检查，首次推送后还需观察远程运行结果。

版本库包含源代码、锁文件、迁移、测试与文档。`.gitignore` 排除环境文件、密钥文件、依赖、本地数据库、构建产物、运行时及验证截图。`.openai/hosting.json` 是托管配置及站点标识，不含访问凭证；如果将来更换托管平台，应作为单独迁移处理。
