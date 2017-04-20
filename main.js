'use strict';
var CryptoJS = require("crypto-js");
var express = require("express");
var bodyParser = require('body-parser');
var WebSocket = require("ws");

var device = process.env.DEVICE || ('device-' + Math.random());
var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = process.env.P2P_PORT || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];



let debug =
    // (...msg) => console.log(...msg);
    () => {};



let onNewBlock;

switch (device) {
    case 'gateway':
        onNewBlock = (block) => {
            if (block.data.type === DataType.READING) {
                console.log(`Reading ${block.data.value} published by ${block.data.device}`);
            } else if (block.data.type === DataType.COMMAND) {
                console.log(`Command ${block.data.name} sent to ${block.data.device}`);
            }
        }
        break;
    case 'temperature':
        onNewBlock = (block) => {};
        let temperature = 32;
        setInterval(() => {
            sendReading(temperature);
            temperature += (Math.random() > 0.5 ? 1 : -1) * Math.random();
        }, 5000);
    case 'lights':
        onNewBlock = (block) => {
            if (block.data.type === DataType.COMMAND && block.data.device === device) {
                switch (block.data.name) {
                    case 'on':
                        console.log('lights on');
                        break;
                    case 'off':
                        console.log('lights off');
                        break;
                    default:
                        console.log(`unknown command ${block.data.name}`)
                }
            }
        };
        break;
    default:
        throw `invalid device id: ${device}`
}

const DataType = {
    COMMAND: 'command',
    READING: 'reading',
};










class Block {
    constructor(index, previousHash, timestamp, data, hash) {
        this.index = index;
        this.previousHash = previousHash.toString();
        this.timestamp = timestamp;
        this.data = data;
        this.hash = hash.toString();
    }
}

var sockets = [];
var MessageType = {
    QUERY_LATEST: 0,
    QUERY_ALL: 1,
    RESPONSE_BLOCKCHAIN: 2
};

var getGenesisBlock = () => {
    return new Block(0, "0", 1465154705, "my genesis block!!", "816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7");
};

var blockchain = [getGenesisBlock()];

var initHttpServer = () => {
    var app = express();
    app.use(bodyParser.json());

    app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain)));
    app.post('/mineBlock', (req, res) => {
        var newBlock = generateNextBlock(req.body.data);
        addBlock(newBlock);
        broadcast(responseLatestMsg());
        debug('block added: ' + JSON.stringify(newBlock));
        res.send();
    });
    app.post('/sendCommand', (req, res) => {
        sendCommand(req.body.device, req.body.name);
        res.send();
    });
    app.get('/peers', (req, res) => {
        res.send(sockets.map(s => s._socket.remoteAddress + ':' + s._socket.remotePort));
    });
    app.post('/addPeer', (req, res) => {
        connectToPeers([req.body.peer]);
        res.send();
    });
    app.listen(http_port, () => debug('Listening http on port: ' + http_port));
};

var sendReading = (value) => {
    let reading = {
        type: DataType.READING,
        device,
        value
    };
    var newBlock = generateNextBlock(reading);
    addBlock(newBlock);
    broadcast(responseLatestMsg());
};

var sendCommand = (device, name) => {
    let command = {
        type: DataType.COMMAND,
        device,
        name,
    }
    var newBlock = generateNextBlock(command);
    addBlock(newBlock);
    broadcast(responseLatestMsg());
    debug('block added: ' + JSON.stringify(newBlock));
}


var initP2PServer = () => {
    var server = new WebSocket.Server({port: p2p_port});
    server.on('connection', ws => initConnection(ws));
    debug('listening websocket p2p port on: ' + p2p_port);

};

var initConnection = (ws) => {
    sockets.push(ws);
    initMessageHandler(ws);
    initErrorHandler(ws);
    write(ws, queryChainLengthMsg());
};

var initMessageHandler = (ws) => {
    ws.on('message', (data) => {
        var message = JSON.parse(data);
        debug('Received message', JSON.stringify(message, null, 4));
        switch (message.type) {
            case MessageType.QUERY_LATEST:
                write(ws, responseLatestMsg());
                break;
            case MessageType.QUERY_ALL:
                write(ws, responseChainMsg());
                break;
            case MessageType.RESPONSE_BLOCKCHAIN:
                handleBlockchainResponse(message);
                break;
        }
    });
};

var initErrorHandler = (ws) => {
    var closeConnection = (ws) => {
        debug('connection failed to peer: ' + ws.url);
        sockets.splice(sockets.indexOf(ws), 1);
    };
    ws.on('close', () => closeConnection(ws));
    ws.on('error', () => closeConnection(ws));
};


var generateNextBlock = (blockData) => {
    var previousBlock = getLatestBlock();
    var nextIndex = previousBlock.index + 1;
    var nextTimestamp = new Date().getTime() / 1000;
    var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData);
    return new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, nextHash);
};


var calculateHashForBlock = (block) => {
    return calculateHash(block.index, block.previousHash, block.timestamp, block.data);
};

var calculateHash = (index, previousHash, timestamp, data) => {
    return CryptoJS.SHA256(index + previousHash + timestamp + JSON.stringify(data)).toString();
};

var addBlock = (newBlock) => {
    if (isValidNewBlock(newBlock, getLatestBlock())) {
        appendToChain(newBlock);
    }
};

var isValidNewBlock = (newBlock, previousBlock) => {
    if (previousBlock.index + 1 !== newBlock.index) {
        debug('invalid index');
        return false;
    } else if (previousBlock.hash !== newBlock.previousHash) {
        debug('invalid previoushash');
        return false;
    } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
        debug(typeof (newBlock.hash) + ' ' + typeof calculateHashForBlock(newBlock));
        debug('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
        return false;
    }
    return true;
};

var connectToPeers = (newPeers) => {
    newPeers.forEach((peer) => {
        var ws = new WebSocket(peer);
        ws.on('open', () => initConnection(ws));
        ws.on('error', () => {
            debug('connection failed')
        });
    });
};

var handleBlockchainResponse = (message) => {
    var receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index - b2.index));
    var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
    var latestBlockHeld = getLatestBlock();
    if (latestBlockReceived.index > latestBlockHeld.index) {
        debug('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            debug("We can append the received block to our chain");
            appendToChain(latestBlockReceived);
            broadcast(responseLatestMsg());
        } else if (receivedBlocks.length === 1) {
            debug("We have to query the chain from our peer");
            broadcast(queryAllMsg());
        } else {
            debug("Received blockchain is longer than current blockchain");
            replaceChain(receivedBlocks);
        }
    } else {
        debug('received blockchain is not longer than received blockchain. Do nothing');
    }
};

var appendToChain = (newBlock) => {
    blockchain.push(newBlock);
    onNewBlock(newBlock);
};

var replaceChain = (newBlocks) => {
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        debug('Received blockchain is valid. Replacing current blockchain with received blockchain');
        blockchain = newBlocks;
        for (let newBlock of newBlocks) {
            onNewBlock(newBlock);
        }
        broadcast(responseLatestMsg());
    } else {
        debug('Received blockchain invalid');
    }
};

var isValidChain = (blockchainToValidate) => {
    if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) {
        return false;
    }
    var tempBlocks = [blockchainToValidate[0]];
    for (var i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        } else {
            return false;
        }
    }
    return true;
};

var getLatestBlock = () => blockchain[blockchain.length - 1];
var queryChainLengthMsg = () => ({'type': MessageType.QUERY_LATEST});
var queryAllMsg = () => ({'type': MessageType.QUERY_ALL});
var responseChainMsg = () =>({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
});
var responseLatestMsg = () => ({
    'type': MessageType.RESPONSE_BLOCKCHAIN,
    'data': JSON.stringify([getLatestBlock()])
});

var write = (ws, message) => ws.send(JSON.stringify(message));
var broadcast = (message) => sockets.forEach(socket => write(socket, message));

connectToPeers(initialPeers);
initHttpServer();
initP2PServer();

