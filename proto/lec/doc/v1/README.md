# lec.doc.v1

Lec Doc 在阶段 A 是 `lec.core.v1.AuthorizationService` / `ResourceService` 的 **gRPC consumer**，对浏览器的 HTTP 契约位于 `openapi/lec/doc/v1/`。

本目录保留 `lec.doc.v1` 业务命名空间，但不为满足目录结构而虚构一个无人调用的 RPC。阶段 B 若出现真实的内部 Doc 控制面需求，再以向后兼容方式加入 `.proto`。
