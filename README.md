# Websocket Client for WeChat Mini Programs

## About
This plugin is built for developers using Adonis JS with Websockets enabled on the backend and WeChat Mini Programs on the frontend.

You can use all client APIs available in the official browser client (docs here):

[Adonis Websocket Client Docs](https://adonisjs.com/docs/websocket)

## Setup
1. Install the package
```
npm install adonis-websocket-wechatmp
```
>You may freely use this NPM package in 3rd party frameworks like Taro, Wepy, MPVue, etc.
>
>Vanilla Framework: [NPM package install guide](https://developers.weixin.qq.com/miniprogram/dev/devtools/npm.html?t=18082018)

2. Then in your Mini Program project:
>```/pages/page/page.js```
>```javascript
>import Ws from 'adonis-websocket-wechatmp'
>const ws = Ws('ws:// -or- wss://your-url-here')
>
>Page({
>   data: {},
>   onLoad () {
>       // init websocket connection
>   }
>})
>```