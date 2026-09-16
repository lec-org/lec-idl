# @lec/idl-cli

薄 IDL 拉取/生成 CLI。把远端 `lec-org/lec-idl` 的契约（proto / openapi / schema）作为**数据源**拉取，解析 `service@ref` 为精确 commit SHA 写入 `idl.lock.json`，并用本包固定版本的 Buf、`protoc-gen-es` 与 `openapi-typescript` 生成本地 TypeScript 类型。

## 安全边界

- 只把远端分支当数据源，**绝不执行远端携带的任何脚本**；
- 生成器版本固定在本包依赖中；Git checkout 禁用 hooks；
- **不在 `postinstall` 运行**，必须由 `npm run idl` 显式触发，保证离线安装可复现、不隐式改源码；
- 每个 service 的 ref 解析为精确 commit SHA 并写入 `idl.lock.json`。

## 前端仓集成

`idl.config.json`：

```json
{
  "$schema": "https://raw.githubusercontent.com/lec-org/lec-idl/main/schema/frontend-config.schema.json",
  "outDir": "./src/generated",
  "services": {
    "core": "lec.core@main",
    "doc": "lec.doc@feature/doc-pdp"
  }
}
```

前端仓通过 Git commit 固定 CLI（版本发布后也可改为固定 npm 版本）：

```json
{
  "devDependencies": {
    "@lec/idl-cli": "github:lec-org/lec-idl#<commit-sha>"
  },
  "scripts": {
    "idl": "idl",
    "idl:resolve": "idl --resolve-only",
    "idl:check": "idl --check"
  }
}
```

## 命令

```bash
idl                          # 拉取精确 SHA、生成 TypeScript、写 lock
idl --service doc@feature/x  # 临时覆盖单个 service 的 ref
idl --resolve-only           # 只解析 ref→SHA 写 lock，不拉取/生成
idl --check                  # CI 重生成并校验 lock 与生成物无漂移，不写文件
```

生成目录按 alias 隔离：`<outDir>/<alias>/proto/**` 与 `<outDir>/<alias>/openapi.ts`。生成目录禁止手改，应和 `idl.lock.json` 一起提交。
