---
name: fanhan-recruiting
description: 用 fanhan CLI 操作泛函招聘系统，管理公司与文字 JD、上传简历、查询处理队列、双向匹配、生成招聘文案及创建或撤销分享链接。需要目标实例的有效 API Key。
---

# 泛函招聘

使用 `fanhan --help --json` 查看当前命令，`fanhan schema --json` 查看能力清单。未安装命令时，在本仓库运行 `node ops/recruiting/fanhan.mjs`。需要 Node.js 22 或更新版本。

## 连接

凭据使用 `FANHAN_API_KEY` 环境变量（兼容 `TWENTY_API_KEY`）；实例地址使用 `FANHAN_BASE_URL`（兼容 `TWENTY_BASE_URL`）或 `--base`。默认地址是本地 `http://localhost:23001`。远程必须 HTTPS。不要把 Key 放命令参数、输出或文件中。

先执行 `fanhan auth status --json` 验证连接。API Key 的实际权限由服务端决定；403不能通过换接口、直连数据库或使用别人身份绕过。

## 工作流程

1. `companies search --query 公司名`，确认公司；不存在才 `companies create --name 公司名 --domain 网站 --description 简介`。
2. `jobs submit --company-id ID --text-file JD.txt --key REQUEST_ID --wait`。JD原文是文字；多岗位可以在同一文字文件中分段描述。不要上传Word或PDF作为JD。
3. `resume upload --file 简历.pdf --note-file 说明.txt --key REQUEST_ID --wait`。图片、PDF、Word、TXT、HTML、Markdown均可。说明可选；相同邮箱自动更新同一候选人，历史附件保留。显式更新用 `--candidate-id ID`。
4. `queue list --json` 读取统一任务。`task get --kind intake --id ID` 查看材料、解析和关联匹配；`task retry --kind intake --id ID` 重试失败阶段。202仅表示受理，不能据此声称入库或匹配完成。
5. `match candidate --id ID --wait` 或 `match job --id ID --wait`；限定比较用 `--targets ID,ID`，特定组合用 `match pair --candidate-id ID --job-id ID --wait`。检查 counts、complete、stale 和 error。最多十项结果，不能把失败当零分。
6. 按用户选择执行 `draft matches --match-run-id ID --selected-ids ID,ID --key REQUEST_ID --wait`。人找岗的selected-ids是岗位ID，岗找人则是候选人ID。`draft edit --id ID --items-file draft.json` 保存 title/body。生成不等于发送。
7. `share create --job-ids ID,ID --candidate-ids ID,ID` 创建短链接；任一数组可省略，但不能都为空。`share list` 查看本人链接，`share revoke --id KEY` 删除访问能力，立即失效。链接路径最后一段是KEY。岗位页显示当前招聘状态；候选人页只公开职业资料。
8. `jobs status --id ID --status CLOSED` 停招；恢复用 RECRUITING。只在用户要求时修改招聘状态。

## 结果与恢复

所有结果输出 JSON。错误写 stderr，退出码1；业务处理失败或部分成功退出码2。`--wait` 等待阶段终态，材料入库成功后仍应检查关联匹配任务；超时保留返回的任务ID继续查询。

同一次提交的重试复用 `--key`，材料变化使用新key。原始文字用 `--text-file`，说明用 `--note-file`，避免shell转义改变原文。分享链接是访问凭据，只交给任务要求的接收者；不在公开日志输出。CLI没有自动发送消息的能力。
