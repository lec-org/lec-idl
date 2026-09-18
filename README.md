# lec-idl

Lec 平台的接口契约单一真源（Interface Definition Language）。用 **GitHub 仓库 + 分支/标签 + PR + Actions + 静态 Swagger/Redoc + 薄 CLI** 承载接口治理，不自建常驻接口管理平台。

> 状态：**目标/待实现**。本仓提供的契约尚未被任何服务生成或消费；服务侧接入是后续阶段的工作。契约先行不代表能力已上线。

## 布局

```text
proto/lec/            # 内部 gRPC 与事件契约（Protobuf）
├── core/v1/          # 授权 PDP、身份解析、成员资格、资源生命周期
├── chat/v1/          # LecIM 对外 Chat 控制契约（防腐层）
├── identity/v1/      # Lec SSO Adapter（Logto 管理门面）
├── doc/v1/           # Doc 业务命名空间（阶段 A 无虚构 RPC）
└── events/v1/        # Kafka EventEnvelope 与生命周期事件
openapi/lec/          # 浏览器/Desktop 的 HTTP API
├── core/v1/          # Core 内部 HTTP（doc-authorize / batch）
└── doc/v1/           # Lec Doc HTTP
schema/               # frontend-config.schema.json
cli/                  # @lec/idl-cli 薄拉取/生成 CLI
```

命名空间按**业务域**划分，不按实现语言划分。

## 分支与版本模型

```text
main            稳定、向后兼容
develop         下一集成版本
feature/*       短期联调契约
release/v1.x    维护线
v1.3.0          不可变发布标签
<commit SHA>    完全锁定
```

- 本地开发可引用 feature 分支；
- PR/CI 必须生成并校验 lock；
- 生产发布只能锁定到 tag 或 SHA；已发布 tag 禁止移动；
- 已发布 Proto 需通过 `buf breaking`。

## 本地校验

```bash
buf lint
buf build
buf breaking --against 'https://github.com/lec-org/lec-idl.git#branch=main'
```

OpenAPI：`npx @redocly/cli lint openapi/lec/**/openapi.yaml`。

## 前端消费

见 [`cli/README.md`](cli/README.md)：前端仓放 `idl.config.json`，用 `npm run idl` 显式拉取 `service@ref`、锁定 `resolvedCommit`。**不在 `postinstall` 联网，远端分支只作数据源，绝不执行其脚本。**

## 安全边界

- 静态 Swagger/Redoc 不启用在线调试（"Try it out"），避免扩大生产 Token 暴露面；
- 生成器版本固定，不运行远端携带的脚本；
- 授权唯一真源是 Lec Core，任何生成的客户端都不得把本地 ACL 当 allow fallback。
