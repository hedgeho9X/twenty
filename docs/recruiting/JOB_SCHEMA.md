# 当前岗位解析契约

## 输入与处理

POST /recruiting/job-intakes 接收 companyId、text（岗位原文）、可选 files、note、source/sourceId、idempotencyKey。UI 当前只提供多条文字 JD，不提供 JD 补充说明框；API 仍保留兼容的 note 和文件入口。

服务端绑定公司，附带公司名称、简介和招聘偏好；文字直接进入提取，文件先经 Docling/页面渲染。使用 AI 功能 jd_extraction 的所选模型，通过 AI SDK generateText + Output.object 输出；长材料分段提取事实后合并，不截断丢页。

权威 Zod schema 位于 packages/twenty-server/src/modules/recruiting/intake/schemas.ts；同目录 job-profiles.schema.json 为从该 schema 导出的 JSON Schema。

## 模型输出

顶层字段全部必需：jobs（数组）、needsReview（布尔）、reviewNotes（字符串数组）。一份材料允许多个岗位。

每个 jobs 元素：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| title | string | 岗位名称 |
| description | string | 完整岗位正文，包含职责、要求、薪资等 |
| preferences | string | 岗位招聘偏好 |
| category | enum 或 null | engineering / product / design / operations / growth_marketing / sales_business / data_ai / other |
| employmentTypes | enum[] | full_time / part_time / internship / contract |
| workModes | enum[] | onsite / hybrid / remote |
| locations | string[] | 地点原文 |
| needsReview | boolean | 是否存在待核对内容 |
| reviewNotes | string[] | 待核对原因 |

未知枚举/地点不猜测，分别允许 category=null 或空数组。薪资上下限、币种、经验年限、学历、职责列表和技能要求目前没有独立类型字段，保留在 description。当前 needsReview 是数据标记，不是强制人工确认步骤。

## 入库映射

- title → name；description → jobDescription（Markdown 富文本）；preferences → jobRecruitmentPreferences。
- employmentTypes/workModes → 原生 jobAttributes 可接受的选项，同时完整保留在 recruitingProfile。
- 整个模型岗位对象 → recruitingProfile，再由服务端补 sourceIntakeId、sourceItemId、sourceHash、sourceDraftHash。
- companyId 来自请求中已验证的公司，岗位/条目 ID 由服务端生成，不由模型填写。
- 创建时至少要求 title 和 description 非空。通常新建为 RECRUITING；历史重解析导入结束后需按旧状态恢复 CLOSED/NEEDS_DETAILS，避免重新开启历史停招岗位。
- 原始 JD 在 intake.input.text 中保留；派生描述不替代原文。成功条目使用稳定 ID，重复请求不重复创建。

## 页面查看

处理队列 → 岗位任务详情显示完整解析字段；公司与岗位 → 已有岗位 / 查看全部 → 查看解析使用同一资料卡读取已保存的 recruitingProfile。包含招聘偏好、分类、雇佣类型、工作方式、地点、需核对标记、岗位核对原因和完整正文；单岗位与多岗位批次均支持，原始 JSON 默认折叠。只读展示不触发重新解析或修改记录。
