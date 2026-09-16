# @lec/idl-cli

薄 IDL 拉取/生成 CLI。把远端 `lec-org/lec-idl` 的契约（proto / openapi / schema）作为**数据源**拉取，解析 `service@ref` 为精确 commit SHA 写入 `idl.lock.json`，再交给**前端仓固定的生成器**产出类型。

## 安全边界

- 只把远端分支当数据源，**绝不执行远端携带的任何脚本**；
- 生成器版本固定在前端仓依赖或调用命令中；
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
  },
  "generate": { "int64": "string", "client": "fetch" }
}
```

`package.json` scripts（生成器在这里固定，CLI 不代跑远端脚本）：

```json
{
  "scripts": {
    "idl": "idl && buf generate ... && openapi-typescript ...",
    "idl:resolve": "idl --resolve-only",
    "idl:check": "idl --check"
  }
}
```

## 命令

```bash
idl                          # 解析全部 service -> 写 lock（再由 scripts 接生成器）
idl --service doc@feature/x  # 临时覆盖单个 service 的 ref
idl --resolve-only           # 只解析 ref->SHA 写 lock，不下载/生成（离线冒烟）
idl --check                  # CI 校验 lock 与远端解析是否一致，不写文件
```
