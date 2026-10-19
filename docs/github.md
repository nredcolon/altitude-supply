# GitHub 维护说明

当前代码位于独立目录 `overseas-supply`，该目录本身就是 Git 仓库。不要从上一级工作资料目录推送，以免把方案、品牌素材等无关文件带入代码库。

目标代码仓库：[nredcolon/altitude-supply](https://github.com/nredcolon/altitude-supply)。主分支为 `main`，开发分支为 `codex/catalog-foundation`，首次同步采用同一份通过本地检查的项目代码。

2026年10月19日同步状态：已通过 GitHub 官方 CLI 完成本机授权，将 `main` 和 `codex/catalog-foundation` 首次推送到目标仓库，并核对两个远程分支与本地提交一致。原有提交历史完整保留，本地分支已关联对应远程分支。登录凭据由系统钥匙串保存，不写入项目文件。

首次推送已完成，所用命令为：

```sh
git push -u origin main codex/catalog-foundation
```

## 不同机器获取代码

首次在另一台机器下载：

```sh
git clone --branch main https://github.com/nredcolon/altitude-supply.git
cd altitude-supply
npm ci
```

已有副本且工作区干净时，更新主分支：

```sh
git switch main
git pull --ff-only origin main
npm ci
```

切换机器前，先在当前开发分支提交并执行 `git push`；另一台机器再拉取同一分支。尚未合入主分支的开发代码位于 `codex/catalog-foundation`，需要切换到该分支再拉取。本地保存文件不会自动上传 GitHub。环境配置和本地数据库按 README 在每台机器单独准备，不随源码同步。

## 日常开发与检查

后续开发在 `codex/` 前缀分支提交，通过 PR 合入 `main`。常规同步：

```sh
git fetch origin
git push -u origin codex/catalog-foundation
```

目标仓库如有新增提交，应先读取和协调历史，不要强推。CI 执行类型检查、业务与接口测试、生产构建，不自动部署。

建议按 `M1 商户与标准货盘`、`B1 海外选品询价`、`M2 自动匹配组货`、`M3 对外报价` 建立里程碑，每个 Issue 写明业务场景与验收。仓库包含相应的 Issue 和 PR 模板。

CI 使用官方 [checkout](https://github.com/actions/checkout) 与 [setup-node](https://github.com/actions/setup-node) 的工作流接口，Node 版本由 `.nvmrc` 统一维护。每次推送和 PR 都会触发检查，实际运行结果见 [GitHub Actions](https://github.com/nredcolon/altitude-supply/actions)。

版本库包含源代码、锁文件、迁移、测试与文档。`.gitignore` 排除环境文件、密钥文件、依赖、本地数据库、构建产物、运行时及验证截图。`.openai/hosting.json` 是托管配置及站点标识，不含访问凭证；如果将来更换托管平台，应作为单独迁移处理。
