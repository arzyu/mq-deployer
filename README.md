# mq-deployer

基于 AMQP 消息的自动分发程序。

## 运行消息监听服务 & 发送消息

```bash
## 使用 pm2 启动自动分发程序（consumer）
## 需要注意 process.yml 中参数的配置
pm2 start process.yml

## 发送分发指令（producer）
npm run producer -- --uri <amqp_uri> --exchange <amqp_exchange> --router <amqp_router> -m '{"packageUrl": "...."}'
```

## AMQP 服务端配置要求

创建参数 `amqp_exchange` 指定的 AMQP exchange 时，需要设置：

```
Type: topic
Durability: durable
```

