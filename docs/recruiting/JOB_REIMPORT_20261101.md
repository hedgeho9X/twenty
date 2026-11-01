# 原岗位材料重新解析结果

数据来自既有原环境 source.dump 快照，不是本轮重新访问线上。快照中 166 条未删除岗位，53 家公司。仅将有岗位依赖的 39 家公司创建/关联到本地；原本地记录保留。未导入旧 jobSearchJson、分类结果或旧评分。

## API 流程

原岗位标题、Markdown/BlockNote 正文、岗位偏好及原始属性 → 绑定旧公司映射 → POST /recruiting/job-intakes → 当前 jd_extraction 模型与 schema → 原生岗位表。

每个来源岗位使用稳定 sourceId/idempotencyKey，任务和条目幂等；成功后通过原生 REST API 恢复旧招聘状态和来源映射。导入期间暂停自动匹配，防止历史停招岗位被临时当成在招；完成后恢复原配置并重启本地 API/worker。

## 结果

- 166 条来源中，161 条有公司和非空 JD，被提交到解析 API。
- 160 条材料成功，生成 161 条岗位；一条材料拆出两个岗位。
- 入库状态：RECRUITING 46、CLOSED 99、NEEDS_DETAILS 16。逐条回读状态与来源映射，状态不一致 0。
- 6 条待补：缺公司归属 3（含一条全空记录）；无 JD 正文 2；仅“创始人助理/杭州”而无职责要求 1，模型返回空正文后被校验拦住。
- 缺资料条目未编造公司、职责或要求。原始数据、任务 ID、源到目标映射、失败详情在 .local/recruiting/job-reimport/source.json、manifest.json、verification.json，均保存在私有目录。

本轮仅重新解析并导入岗位，没有恢复旧复杂 JSON 或自动对外联系；最新完整匹配与文案业务验收仍单独安排。
