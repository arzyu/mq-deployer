# mq-deployer

## 安装 & 使用

1. 安装

	```bash
	npm install -g mq-deployer
	```

2. 运行服务，监听 rabbitmq 服务端的消息

	```bash
	## 运行 config.yml 中定义的服务队列，用于监听 rabbitmq 服务端的消息
	## config.yml 格式请参考 config.sample.yml
	mq-deployer start config.yml
	```

	如有需要，可以[在本地启动一个用于测试的 rabbitmq 服务](#在本地启动一个用于测试的-rabbitmq-服务)。

3. 发送消息

	```bash
	## 向 rabbitmq 发送一个部署包消息并等待服务队列完成部署
	## 消息内容为 JSON 字符串 { "packageUrl": ".../xxx.tar.gz" }
	## 目前仅支持处理 tag.gz 包
	mq-deployer send \
	  --uri amqp://admin:5IOdXo12V87F5aD4yiIGZd8R000oCuL6@localhost:5672/%2F \
	  --exchange test \
	  --router com.project-a \
	  "{\"packageUrl\": \".../xxx.tar.gz\"}"
	```

## 在本地启动一个用于测试的 rabbitmq 服务

使用 [docker-compose](https://github.com/docker/compose) 启动 rabbitmq 服务

```bash
cd rabbitmq
docker-compose up
```

等待 rabbitmq 服务运行后，访问 <http://localhost:15672> 登录 rabbitmq 管理界面。帐号、密码可以从 `rabbitmq/docker-compose.yml` 中获得。

在 rabbitmq 管理界面中可以查看 Connections, Channels, Exchanges, Queues 等信息。
