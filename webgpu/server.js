// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

// 创建存放训练数据的文件夹
const dir = path.join(__dirname, 'dataset');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

const server = http.createServer((req, res) => {
    // 允许跨域
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'File-Name');

    if (req.method === 'POST' && req.url === '/save') {
        const fileName = req.headers['file-name'];
        const filePath = path.join(dir, fileName);

        // 直接将请求的二进制 body 流式写入文件
        const writeStream = fs.createWriteStream(filePath);
        req.pipe(writeStream);

        req.on('end', () => {
            console.log(`Saved: ${fileName}`);
            res.writeHead(200);
            res.end('OK');
        });
    } else {
        res.writeHead(200);
        res.end('Server running');
    }
});

server.listen(3000, () => {
    console.log('数据接收服务器启动在 http://localhost:3000');
});