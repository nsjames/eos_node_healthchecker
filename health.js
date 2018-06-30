require('es6-promise').polyfill();
require('isomorphic-fetch');

const fs = require('fs');

const getJson = async url => Promise.race([
    new Promise((resolve) => setTimeout(() => false, 2000)),
    await fetch(url).then(x => x.json()).catch(x => null)
]);

const checkCORS = async url => {
    return fetch(`${url}/v1/chain/get_block`, {
        body: JSON.stringify({"block_num_or_id": 1}),
        cache: 'no-cache',
        headers: {
            'user-agent': 'Mozilla/4.0 MDN Example',
            'content-type': 'application/json',
            'origin':'http://scattellet.com'
        },
        method: 'POST',
        mode: 'cors',
        redirect: 'error',
        referrer: 'no-referrer',
    })
        .then(response => {
            console.log('respo', response.headers);

            return response.headers.hasOwnProperty('_headers')
                && response.headers._headers.hasOwnProperty('access-control-allow-origin')
                && response.headers._headers['access-control-allow-origin'].length === 1
                && response.headers._headers['access-control-allow-origin'].includes('*')
                && !response.headers._headers['server'].includes('cloudflare')
        })
        .catch(() => false)
};

//last_irreversible_block_num
const getNodes = async () => {

    // const test = await checkCORS('https://node1.bp2.io');
    // console.log('test', test);
    // return false;

    const jsons = await getJson('https://validate.eosnation.io/bps.json');

    let latestBlocks = jsons.producers
        .filter(x =>
            x.hasOwnProperty('output')
            && x.output.hasOwnProperty('nodes')
            && x.output.nodes.hasOwnProperty('api_http')
            && x.output.nodes.api_http.find(n => n.hasOwnProperty('response') && n.response.hasOwnProperty('last_irreversible_block_num'))
            && x.output.nodes.api_http.find(n => n.response.last_irreversible_block_num > 0)
        ).map(x => {
            const outputs = x.output.nodes.api_http;
            const t = outputs.find(n => n.response.last_irreversible_block_num > 0);
            return t.response.last_irreversible_block_num;
        }).sort().reverse();

    const highestBlock = latestBlocks[0];

    const hasLatestBlock = async endpoint => {
        const get_info = await getJson(`${endpoint}/v1/chain/get_info`);
        if(!get_info) return false;
        return get_info.last_irreversible_block_num >= highestBlock-50;
    };

    latestBlocks = latestBlocks.filter(x => x >= highestBlock-50);

    const endpoints = jsons.producers
        .filter(x => x.hasOwnProperty('input') && x.input.hasOwnProperty('nodes'))
        .filter(x => x.input.nodes.some(y => y.hasOwnProperty('ssl_endpoint') && y.ssl_endpoint.length))
        .map(producer => {
        // console.log('prod', producer.input.nodes);

        let http = producer.input.nodes.find(n => n.hasOwnProperty('api_endpoint') && n.api_endpoint.length);
        let https = producer.input.nodes.find(n => n.hasOwnProperty('ssl_endpoint') && n.ssl_endpoint.length);

        http = http ? http.api_endpoint.replace('http://','') : '';
        https = https ? https.ssl_endpoint.replace('https://','') : '';
        http = http ? http.indexOf(':') > -1 ? '' : http : '';
        https = https ? https.indexOf(':') > -1 ? '' : https : '';

        return {http, https};
    }).filter(x => x.http.length || x.https.length);

    const latestBlockEndpoints = (await Promise.all(endpoints.map(async endpoint => {
        const http = endpoint.http.length ? await hasLatestBlock(`http://${endpoint.http}`) : false;
        const https = endpoint.https.length ? await hasLatestBlock(`https://${endpoint.https}`) : false;

        const result = {http:'', https:''};
        if(http) result.http = endpoint.http;
        if(https) result.https = endpoint.https;
        return result;
    })));

    const corsEnabledEndpoints = (await Promise.all(latestBlockEndpoints.map(async endpoint => {
        const http = endpoint.http.length ? await checkCORS(`http://${endpoint.http}`) : false;
        const https = endpoint.https.length ? await checkCORS(`https://${endpoint.https}`) : false;

        const result = {http:'', https:''};
        if(http) result.http = endpoint.http;
        if(https) result.https = endpoint.https;
        return result;
    })));


    let serverBlock = 'upstream nodes {\n'
    serverBlock += '    ip_hash;\n'
    corsEnabledEndpoints.map(endpoint => {
        if(endpoint.http.length) serverBlock += `\n    server ${endpoint.http};`
    })
    serverBlock += '\n}\n'
    serverBlock += '\n'


    serverBlock += 'upstream ssl_nodes {\n'
    serverBlock += '    ip_hash;\n'
    corsEnabledEndpoints.map(endpoint => {
        if(endpoint.https.length) serverBlock += `\n    server ${endpoint.https}:443;`
    })
    serverBlock += '\n}\n'

    const SERVER_BLOCK_DEFAULTS = `
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    `

    const SERVER_BLOCK_RESOLVER = `
        resolver                  8.8.8.8 valid=300s;
        resolver_timeout          10s;
    `

    // const SERVER_NAME = 'nodes.get-scatter.com';
    // const SSL_CERT="/etc/letsencrypt/live/nodes.get-scatter.com/fullchain.pem;";
    // const SSL_KEY="/etc/letsencrypt/live/nodes.get-scatter.com/privkey.pem;";

    const SERVER_NAME = 'nodes2.get-scatter.com';
    const SSL_CERT="/etc/letsencrypt/live/nodes2.get-scatter.com/fullchain.pem;";
    const SSL_KEY="/etc/letsencrypt/live/nodes2.get-scatter.com/privkey.pem;";

    serverBlock += `
server {
    listen 80;
    
    location / {
        proxy_pass http://nodes;
        ${SERVER_BLOCK_DEFAULTS}
        ${SERVER_BLOCK_RESOLVER}
    }
}
server {
    listen 443 ssl;
    server_name ${SERVER_NAME};
    proxy_ssl_session_reuse on;
    ssl_certificate ${SSL_CERT}
    ssl_certificate_key ${SSL_KEY}
    ssl_verify_client off;
    
    location / {
        proxy_pass https://ssl_nodes;
        ${SERVER_BLOCK_DEFAULTS}
        ${SERVER_BLOCK_RESOLVER}
    }
}
`

    console.log(serverBlock)

    const SERVER_BLOCK_PATH="/etc/nginx/sites-available/default";
    //const SERVER_BLOCK_PATH="E:/test";
    fs.writeFile(SERVER_BLOCK_PATH, serverBlock, function(err) {
        if(err) {
            return console.log(err);
        }

        console.log("The file was saved!");
    });

}


getNodes();