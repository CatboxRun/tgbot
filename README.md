# Liminal Network AI 客服机器人

对外人设：**Liminal Network AI 客服**。内部按角色展示不同话术。

## 角色可见性

| 角色 | 看到什么 |
|------|----------|
| 普通用户 | 客服欢迎 + 项目问答；闲聊才提醒问项目；资料没有则转人工社群 |
| 协作（管理员） | 上述 + 发视频/截图可整理配文并同步官方社群 |
| 总控（创建者） | 上述 + 回复「协作」打开协作台 |

## 启动

```bash
cd tg-bot
npm install
npm start
```

把 `@Liminal_CNbot` 拉进目标群并给发消息权限。

## 配置 `.env`

- `BOT_TOKEN` / `DEEPSEEK_API_KEY`
- `OWNER_USERNAME=XLswSpider`
- `TARGET_CHAT=@Liminal_CN`

密钥勿提交仓库；若曾在聊天中泄露请立即轮换。
