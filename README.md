# 刷词神器

面向手机、平板和电脑的 CET-4/CET-6 刷词 PWA。页面、5.9 万词中英词典、英美双音词典包与核心例句发音均可离线使用。

## 功能

- 22 个主题单元，以及“全部单词随机”和“例句生词”单元
- 答错后必须完整订正，订正完成后才允许进入下一词
- 错误本、生词本连续答对三遍后自动移出
- 总览支持单元顺序、A–Z 和乱序
- 手机和电脑的词汇详情都固定在屏幕中央，可用触摸或鼠标直接左右滑动切词
- 例句和补充中的英文可点按查词；框选单个英文词也可打开释义
- 全部 / 四级 / 六级词典筛选
- 四六级交集词双标签、分级义项、搭配和真题语境
- 搭配、真题、例句和补充中的每个英文词可打开快速小卡，再进入完整详情并逐级返回
- 同词根/关联词、形近词和同义替换分组展示；可靠资料下显示词根含义、拆词与记忆逻辑
- 约 5.9 万词头提供独立英音/美音；完整语音包支持校验、暂停和断点续传
- IndexedDB 按稳定词形保存错题、生词、笔记和进度
- JSON 备份导入/导出，版本升级不覆盖个人学习记录

## 在线使用

- GitHub Pages：<https://jjjqqq123.github.io/shuaci/>
- 公开站点：<https://shuaci-v5.berrybison4.chatgpt.site/>

网页版不需要登录 GPT。首次在线打开即可学习；如需完整离线发音，可在设置中下载英美双音包。

英美双音分片单独存放在公开的 [`shuaci-audio`](https://github.com/jjjqqq123/shuaci-audio) 资源仓库；该仓库只包含音频资源，不含学习记录、API Key 或访问凭据。

## 本地打开

浏览器的离线缓存与 ES Modules 需要 HTTP 环境，不建议直接双击 `index.html`。在本目录启动任意静态服务器即可，例如：

```bash
python -m http.server 8080
```

然后打开 `http://localhost:8080/`。

## 隐私

学习记录只保存在当前浏览器的 IndexedDB 中，仓库不包含个人错题、生词、笔记、账号信息、API Key 或访问令牌。应用也不会把学习记录上传到服务器。

## 数据来源与许可

- 中文词典：KOReader `en-zh`（Open Multilingual WordNet、Princeton WordNet、Wiktionary 汇编），CC BY-SA 4.0
- CET 分类参考：exam-data/CETVocabulary，CC BY-NC-SA 4.0
- 词义关系：Princeton WordNet
- 其他来源及完整归属见 [`data/DICTIONARY-ATTRIBUTION.txt`](data/DICTIONARY-ATTRIBUTION.txt) 与 `data/study-v5.json` 的 `builtFrom` 字段

词典和题库数据须遵守各自上游许可证；本仓库不对这些第三方数据重新授予更宽松的许可。
