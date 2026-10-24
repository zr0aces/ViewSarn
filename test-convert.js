const http = require('http');

const apiKey = process.env.API_KEY;
if (!apiKey) {
    console.error('Usage: API_KEY=<your key> node test-convert.js   (server must be running on :3000)');
    process.exit(1);
}

const data = JSON.stringify({
    html: '<h1>Hello World</h1>',
    options: {
        format: 'A4',
        filename: 'test.pdf'
    }
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/convert',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${apiKey}`
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    console.log(`HEADERS: ${JSON.stringify(res.headers)}`);

    let body = [];
    res.on('data', (chunk) => {
        body.push(chunk);
    });
    res.on('end', () => {
        console.log('Response received');
        if (res.statusCode === 200) {
            console.log('Test PASSED');
        } else {
            console.log('Test FAILED');
            console.log(Buffer.concat(body).toString());
        }
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();
